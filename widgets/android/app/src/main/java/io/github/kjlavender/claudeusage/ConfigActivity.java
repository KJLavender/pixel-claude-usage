package io.github.kjlavender.claudeusage;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** Asks for the panel address (the link the QR code opens). Shown when adding the widget. */
public class ConfigActivity extends Activity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        Bundle extras = getIntent().getExtras();
        if (extras != null) {
            widgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        }

        SharedPreferences prefs = getSharedPreferences(UsageWidget.PREFS, Context.MODE_PRIVATE);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad * 2, pad, pad);
        root.setBackgroundColor(Color.parseColor("#14121f"));

        TextView title = new TextView(this);
        title.setText("Claude Usage 小工具");
        title.setTextColor(Color.parseColor("#d97757"));
        title.setTextSize(20);
        root.addView(title);

        TextView hint = new TextView(this);
        hint.setText("貼上面板網址：在電腦打開 http://localhost:8790/pair，"
                + "用手機掃 QR code 後，複製瀏覽器上的網址貼到這裡。\n\n"
                + "例如 http://192.168.0.16:8790/?k=你的金鑰");
        hint.setTextColor(Color.parseColor("#8d86a8"));
        hint.setPadding(0, pad / 2, 0, pad / 2);
        root.addView(hint);

        EditText url = new EditText(this);
        url.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        url.setTextColor(Color.parseColor("#f2ead8"));
        url.setHint("http://...:8790/?k=...");
        url.setText(prefs.getString(UsageWidget.KEY_URL, ""));
        root.addView(url);

        Button save = new Button(this);
        save.setText("儲存");
        save.setGravity(Gravity.CENTER);
        save.setOnClickListener(v -> {
            String value = url.getText().toString().trim();
            if (!value.startsWith("http")) {
                Toast.makeText(this, "網址要用 http:// 開頭", Toast.LENGTH_SHORT).show();
                return;
            }
            prefs.edit().putString(UsageWidget.KEY_URL, value).apply();
            UsageWidget.refreshAll(this, null);
            if (widgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
                setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
            } else {
                Toast.makeText(this, "已儲存。到主畫面長按 → 小工具 → Claude Usage 加入", Toast.LENGTH_LONG).show();
            }
            finish();
        });
        root.addView(save);

        setContentView(root);
    }
}
