package io.github.kjlavender.claudeusage;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.time.OffsetDateTime;
import java.util.Date;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Home screen widget: shows the 5-hour and weekly Claude usage from the panel server. */
public class UsageWidget extends AppWidgetProvider {
    static final String PREFS = "claude_usage";
    static final String KEY_URL = "panel_url";
    static final String KEY_CACHE = "last_json";
    static final String KEY_CACHE_AT = "last_at";
    static final String ACTION_REFRESH = "io.github.kjlavender.claudeusage.REFRESH";

    static final int INK = Color.parseColor("#f2ead8");
    static final int DIM = Color.parseColor("#8d86a8");
    static final int EMPTY = Color.parseColor("#2b2643");
    static final int OK = Color.parseColor("#7bd88f");
    static final int WARN = Color.parseColor("#ffcb57");
    static final int BAD = Color.parseColor("#ff6b6b");

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        refreshAll(context, goAsync());
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) refreshAll(context, goAsync());
    }

    /** Fetch on a background thread, then redraw every instance of the widget. */
    static void refreshAll(Context context, PendingResult pending) {
        Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                String panel = prefs.getString(KEY_URL, "");
                String error = null;
                if (panel.isEmpty()) {
                    error = "請打開 App 設定面板網址";
                } else {
                    try {
                        String body = fetch(apiUrl(panel));
                        JSONObject j = new JSONObject(body);
                        if (j.has("fiveHour") || j.has("sevenDay")) {
                            prefs.edit().putString(KEY_CACHE, body)
                                    .putLong(KEY_CACHE_AT, System.currentTimeMillis()).apply();
                        }
                        if (!j.isNull("error")) error = j.optString("error");
                    } catch (Exception e) {
                        error = "連不到電腦（顯示上次的資料）";
                    }
                }
                draw(app, prefs, error);
            } finally {
                if (pending != null) pending.finish();
            }
        }).start();
    }

    static void draw(Context context, SharedPreferences prefs, String error) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, UsageWidget.class));
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget);

        JSONObject d = null;
        try { d = new JSONObject(prefs.getString(KEY_CACHE, "")); } catch (Exception ignored) {}

        if (d != null) {
            v.setTextViewText(R.id.plan, d.optString("plan", "").toUpperCase(Locale.ROOT));
            fillWindow(v, d.optJSONObject("fiveHour"), R.id.s_pct, R.id.s_bar, R.id.s_reset);
            fillWindow(v, d.optJSONObject("sevenDay"), R.id.w_pct, R.id.w_bar, R.id.w_reset);
        }

        long at = prefs.getLong(KEY_CACHE_AT, 0);
        String status = error != null ? "⚠ " + error
                : at > 0 ? "更新 " + new SimpleDateFormat("HH:mm", Locale.ROOT).format(new Date(at)) : "";
        v.setTextViewText(R.id.status, status);
        v.setTextColor(R.id.status, error != null ? WARN : DIM);

        // tap ↻ to refresh, tap anywhere else to open the full panel
        Intent refresh = new Intent(context, UsageWidget.class).setAction(ACTION_REFRESH);
        v.setOnClickPendingIntent(R.id.refresh, PendingIntent.getBroadcast(context, 0, refresh,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        String panel = prefs.getString(KEY_URL, "");
        Intent open = panel.isEmpty()
                ? new Intent(context, ConfigActivity.class)
                : new Intent(Intent.ACTION_VIEW, Uri.parse(panel));
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        v.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(context, 1, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        manager.updateAppWidget(ids, v);
    }

    static void fillWindow(RemoteViews v, JSONObject w, int pctId, int barId, int resetId) {
        if (w == null) return;
        String resetsAt = w.optString("resetsAt", "");
        long resetMs = parseTime(resetsAt);
        // once the reset time has passed the window is back to 0%, even with old data
        boolean reset = resetMs > 0 && resetMs <= System.currentTimeMillis();
        int pct = reset ? 0 : w.optInt("percent", 0);
        v.setTextViewText(pctId, pct + "%");
        v.setTextColor(pctId, color(pct));
        v.setImageViewBitmap(barId, bar(pct));
        v.setTextViewText(resetId, reset ? "已重置，額度全滿"
                : countdown(resetMs) + "後重置 · 剩 " + (100 - pct) + "%");
    }

    static int color(int pct) { return pct >= 80 ? BAD : pct >= 50 ? WARN : OK; }

    /** 20 pixel blocks with gaps, stretched to the widget width. */
    static Bitmap bar(int pct) {
        int n = 20, block = 14, gap = 3, h = 8;
        Bitmap b = Bitmap.createBitmap(n * block + (n - 1) * gap, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        Paint p = new Paint();
        int filled = Math.round(Math.min(100, pct) / 100f * n);
        for (int i = 0; i < n; i++) {
            p.setColor(i < filled ? color(pct) : EMPTY);
            int x = i * (block + gap);
            c.drawRect(x, 0, x + block, h, p);
        }
        return b;
    }

    static String countdown(long resetMs) {
        if (resetMs <= 0) return "--";
        long s = Math.max(0, (resetMs - System.currentTimeMillis()) / 1000);
        long d = s / 86400, h = (s % 86400) / 3600, m = (s % 3600) / 60;
        return d > 0 ? d + "天" + h + "時" : h > 0 ? h + "時" + m + "分" : m + "分";
    }

    static long parseTime(String iso) {
        try { return OffsetDateTime.parse(iso).toInstant().toEpochMilli(); } catch (Exception e) { return 0; }
    }

    /** "http://host:port/?k=KEY" -> "http://host:port/api/usage?k=KEY" */
    static String apiUrl(String panel) throws Exception {
        Matcher m = Pattern.compile("^(https?://[^/?#]+)[^?#]*(?:\\?[^#]*?\\bk=([^&#]+))?").matcher(panel.trim());
        if (!m.find()) throw new IllegalArgumentException("bad url");
        String key = m.group(2) == null ? "" : Uri.decode(m.group(2));
        return m.group(1) + "/api/usage?k=" + URLEncoder.encode(key, "UTF-8");
    }

    static String fetch(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(15000);
        try {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int r;
                while ((r = in.read(buf)) > 0) out.write(buf, 0, r);
                return out.toString("UTF-8");
            }
        } finally {
            c.disconnect();
        }
    }
}
