package io.github.kjlavender.claudeusage;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

/**
 * Fetches usage in the background. Runs as a scheduled job so Android only starts it when
 * the phone has a network, and gives it time to retry while a sleeping VPN (Tailscale)
 * wakes up, instead of failing on the first slow request.
 */
public class UpdateJob extends JobService {
    static final int JOB_NOW = 1;
    static final int JOB_RETRY = 2;
    static final long RETRY_DELAY_MS = 3 * 60_000;

    /** Run an update as soon as there is a network. */
    static void schedule(Context context) { schedule(context, JOB_NOW, 0); }

    static void schedule(Context context, int id, long delayMs) {
        JobInfo.Builder b = new JobInfo.Builder(id, new ComponentName(context, UpdateJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY);
        if (delayMs > 0) b.setMinimumLatency(delayMs);
        JobScheduler js = context.getSystemService(JobScheduler.class);
        if (js != null) js.schedule(b.build());
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        Context app = getApplicationContext();
        new Thread(() -> {
            boolean ok = update(app);
            // Still failing: try again in a few minutes rather than waiting for the
            // next 30-minute widget update.
            if (!ok && params.getJobId() == JOB_NOW) schedule(app, JOB_RETRY, RETRY_DELAY_MS);
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return true; }

    /** Fetch with a few retries, save the result, redraw. Returns false if every try failed. */
    static boolean update(Context app) {
        SharedPreferences prefs = app.getSharedPreferences(UsageWidget.PREFS, Context.MODE_PRIVATE);
        String panel = prefs.getString(UsageWidget.KEY_URL, "");
        if (panel.isEmpty()) {
            UsageWidget.draw(app, prefs, "請打開 App 設定面板網址");
            return true;
        }
        UsageWidget.draw(app, prefs, null, true); // show "updating…" while we work
        String error = null;
        boolean reached = false;
        long[] waits = {0, 4_000, 10_000};
        for (long wait : waits) {
            try {
                if (wait > 0) Thread.sleep(wait);
                String body = UsageWidget.fetch(UsageWidget.apiUrl(panel));
                JSONObject j = new JSONObject(body);
                if (j.has("fiveHour") || j.has("sevenDay")) {
                    long at = j.optLong("fetchedAt", System.currentTimeMillis());
                    prefs.edit().putString(UsageWidget.KEY_CACHE, body)
                            .putLong(UsageWidget.KEY_CACHE_AT, at).apply();
                }
                error = j.isNull("error") ? null : j.optString("error");
                reached = true;
                break;
            } catch (Exception e) {
                error = "連不到電腦";
            }
        }
        UsageWidget.draw(app, prefs, error);
        return reached;
    }
}
