package com.moe.councilbridge;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Explicit text bridge; never monitors clipboard or accesses the network. */
public class MainActivity extends Activity {
  public static final String EXTRA_IMPORT_CLIPBOARD = "com.moe.councilbridge.IMPORT_CLIPBOARD";
  private EditText input;
  private TextView status;
  private boolean pendingClipboard = false;

  @Override public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    createUi();
    accept(getIntent());
  }
  @Override protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    accept(intent);
  }
  @Override protected void onResume() {
    super.onResume();
    if (pendingClipboard) input.postDelayed(this::importIfFocused, 280);
  }
  @Override public void onWindowFocusChanged(boolean focused) {
    super.onWindowFocusChanged(focused);
    if (focused && pendingClipboard) input.post(this::importIfFocused);
  }
  private void importIfFocused() {
    if (!pendingClipboard || !hasWindowFocus()) return;
    pendingClipboard = false;
    readClipboard();
  }
  private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }
  private TextView text(String value, int size, int color) {
    TextView t = new TextView(this);
    t.setText(value);
    t.setTextSize(size);
    t.setTextColor(color);
    return t;
  }
  private void createUi() {
    ScrollView scroll = new ScrollView(this);
    scroll.setFillViewport(true);
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(dp(20), dp(28), dp(20), dp(28));
    root.setBackgroundColor(0xff091122);
    scroll.addView(root);
    TextView title = text("Moe Council Bridge", 25, Color.WHITE);
    title.setGravity(Gravity.CENTER_VERTICAL);
    root.addView(title);
    TextView desc = text("Direct test: select text → Send to Moe Council.\nFallback: Copy → Quick Settings → Send to Moe.", 14, 0xffbed3ec);
    desc.setPadding(0, dp(14), 0, dp(16));
    root.addView(desc);
    status = text("Ready. Import text, then review before sharing.", 13, 0xffa5f4c8);
    root.addView(status);
    input = new EditText(this);
    input.setTextColor(Color.WHITE);
    input.setHintTextColor(0xff91a4bb);
    input.setHint("Selected or copied text appears here");
    input.setTextSize(15);
    input.setGravity(Gravity.TOP | Gravity.START);
    input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(220));
    lp.topMargin = dp(15);
    root.addView(input, lp);
    Button paste = new Button(this);
    paste.setAllCaps(false);
    paste.setText("Import clipboard");
    paste.setOnClickListener(v -> readClipboard());
    root.addView(paste);
    Button share = new Button(this);
    share.setAllCaps(false);
    share.setText("Send to AI Council (Android Share)");
    share.setOnClickListener(v -> shareExplicitly());
    root.addView(share);
    Button clear = new Button(this);
    clear.setAllCaps(false);
    clear.setText("Clear imported text");
    clear.setOnClickListener(v -> {
      input.setText("");
      status.setText("Text cleared.");
    });
    root.addView(clear);
    TextView footer = text("Privacy: No Internet, background clipboard, overlay, or Accessibility permission. Text is only shared when you press Send and choose AI Council.", 12, 0xff99afca);
    footer.setPadding(0, dp(18), 0, 0);
    root.addView(footer);
    setContentView(scroll);
  }
  private void accept(Intent intent) {
    if (intent == null) return;
    CharSequence received = null;
    String action = intent.getAction();
    if (Intent.ACTION_PROCESS_TEXT.equals(action)) {
      received = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
      status.setText("Selected text received via PROCESS_TEXT.");
    } else if (Intent.ACTION_SEND.equals(action) && "text/plain".equals(intent.getType())) {
      received = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
      status.setText("Shared text received.");
    }
    if (received != null && received.length() > 0) {
      input.setText(received);
      pendingClipboard = false;
    } else if (intent.getBooleanExtra(EXTRA_IMPORT_CLIPBOARD, false)) {
      pendingClipboard = true;
      status.setText("Opening clipboard import in foreground…");
      input.postDelayed(this::importIfFocused, 350);
    }
  }
  private void readClipboard() {
    ClipboardManager mgr = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
    ClipData clip = mgr == null ? null : mgr.getPrimaryClip();
    if (clip == null || clip.getItemCount() == 0) {
      status.setText("Clipboard empty or not accessible. Copy text in ChatGPT first.");
      return;
    }
    CharSequence value = clip.getItemAt(0).coerceToText(this);
    if (value == null || value.length() == 0) {
      status.setText("No text in clipboard.");
      return;
    }
    input.setText(value);
    status.setText("Clipboard imported. Review, then tap Send.");
  }
  private void shareExplicitly() {
    String value = input.getText().toString();
    if (value.trim().isEmpty()) {
      status.setText("Nothing to share: select or copy some text first.");
      return;
    }
    Intent send = new Intent(Intent.ACTION_SEND);
    send.setType("text/plain");
    send.putExtra(Intent.EXTRA_TEXT, value);
    startActivity(Intent.createChooser(send, "Choose AI Council"));
    status.setText("Select AI Council in Android Share.");
  }
}
