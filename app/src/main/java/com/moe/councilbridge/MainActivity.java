package com.moe.councilbridge;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.StatusBarManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Explicit user-reviewed text bridge. Never reads clipboard in background or sends automatically. */
public class MainActivity extends Activity {
  public static final String EXTRA_IMPORT_CLIPBOARD = "com.moe.councilbridge.IMPORT_CLIPBOARD";
  private static final int MAX_PROMPT = 30000;
  private static final String PREFS = "council_bridge";
  private static final String TARGET_KEY = "preferred_component";
  private EditText input;
  private TextView status, count, destination;
  private boolean pendingClipboard = false;
  private boolean importScheduled = false;

  @Override public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
    buildUi();
    if (savedInstanceState != null) input.setText(savedInstanceState.getString("draft", ""));
    accept(getIntent());
  }
  @Override protected void onSaveInstanceState(Bundle state) {
    state.putString("draft", input.getText().toString());
    super.onSaveInstanceState(state);
  }
  @Override protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    accept(intent);
  }
  @Override protected void onResume() {
    super.onResume();
    scheduleClipboard();
    refreshDestination();
  }
  @Override public void onWindowFocusChanged(boolean focused) {
    super.onWindowFocusChanged(focused);
    if (focused) scheduleClipboard();
  }
  private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }
  private TextView text(String s, int size, int color) {
    TextView t = new TextView(this);
    t.setText(s); t.setTextSize(size); t.setTextColor(color);
    return t;
  }
  private void add(LinearLayout root, TextView view, int margin) {
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.topMargin = dp(margin); root.addView(view, p);
  }
  private Button button(String title, LinearLayout root, int margin) {
    Button b = new Button(this);
    b.setAllCaps(false);
    b.setText(title); b.setTextSize(15); b.setMinHeight(dp(50));
    add(root, b, margin);
    return b;
  }
  private void message(String msg) { status.setText(msg); }
  private void buildUi() {
    ScrollView scroll = new ScrollView(this);
    scroll.setFillViewport(true);
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(dp(20),dp(22),dp(20),dp(30));
    root.setFitsSystemWindows(true);
    root.setFocusableInTouchMode(true);
    root.setBackgroundColor(0xff0a1528);
    scroll.addView(root);
    add(root,text("MOE CONTROL CENTER / AI BRIDGE",11,0xff82bded),3);
    TextView heading = text("Send to AI Council",26,Color.WHITE);
    heading.setTypeface(null,1);
    add(root,heading,9);
    add(root,text("In ChatGPT: select text → Copy → swipe down → Send to Moe. Review before sharing.",14,0xffb7cce5),10);
    status = text("Ready. Nothing sends until you choose Send.",13,0xffa1edcd);
    add(root,status,14);
    input = new EditText(this);
    input.setTextColor(Color.WHITE);
    input.setHintTextColor(0xff8da9c5);
    input.setHint("Copied or selected text appears here…");
    input.setTextSize(16);
    input.setGravity(Gravity.TOP | Gravity.START);
    input.setInputType(android.text.InputType.TYPE_CLASS_TEXT |
        android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);
    LinearLayout.LayoutParams edit = new LinearLayout.LayoutParams(-1,dp(190));
    edit.topMargin=dp(14); root.addView(input,edit);
    count = text("0 characters",12,0xffa2b8ce); add(root,count,5);
    input.addTextChangedListener(new TextWatcher() {
      public void beforeTextChanged(CharSequence s,int start,int n,int after){}
      public void onTextChanged(CharSequence s,int start,int before,int n){
        count.setText(s.length()+" characters"+(s.length()>MAX_PROMPT?" — exceeds Council limit":""));
      }
      public void afterTextChanged(Editable editable){}
    });
    Button send = button("✦ Send to AI Council",root,13);
    send.setTextColor(0xff0a1b2e);
    send.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xffb3dcff));
    send.setOnClickListener(v->sendToCouncil());
    destination = text("",12,0xffa5c7e6); add(root,destination,7);
    button("Import latest clipboard",root,12).setOnClickListener(v->readClipboard());
    button("Find / remember Council app",root,5).setOnClickListener(v->pairCouncil());
    button("Add Send to Moe Quick Settings tile",root,5).setOnClickListener(v->requestTile());
    button("Use Android Share instead",root,5).setOnClickListener(v->shareWithChooser());
    button("Open Council website",root,5).setOnClickListener(v->openWebsite());
    button("Clear text on this screen",root,5).setOnClickListener(v->{
      input.setText(""); message("Screen cleared; Android clipboard unchanged.");
    });
    add(root,text("Privacy: No network or background clipboard permissions. The Bridge shares only after you press Send. No selected text is put into a website URL.",12,0xff90a8c6),20);
    setContentView(scroll);
    root.requestFocus();
    refreshDestination();
  }
  private void accept(Intent intent) {
    if(intent==null)return;
    CharSequence received=null;
    if(Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())){
      received=intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
      message("Selected text received. Review before sending.");
    }else if(Intent.ACTION_SEND.equals(intent.getAction()) &&
        "text/plain".equals(intent.getType())){
      received=intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
      message("Shared text received. Review before sending.");
    }
    if(received!=null && received.length()>0){
      pendingClipboard=false; input.setText(received); input.setSelection(0);
    }else if(intent.getBooleanExtra(EXTRA_IMPORT_CLIPBOARD,false)){
      pendingClipboard=true; message("Importing copied text when app reaches foreground…");
      scheduleClipboard();
    }
    intent.removeExtra(EXTRA_IMPORT_CLIPBOARD);
  }
  private void scheduleClipboard(){
    if(!pendingClipboard || importScheduled || input==null)return;
    importScheduled=true;
    input.postDelayed(()->{
      importScheduled=false;
      if(!pendingClipboard)return;
      if(!hasWindowFocus()){scheduleClipboard();return;}
      pendingClipboard=false;
      readClipboard();
    },250);
  }
  private void readClipboard(){
    ClipboardManager mgr=(ClipboardManager)getSystemService(Context.CLIPBOARD_SERVICE);
    ClipData clip=mgr==null?null:mgr.getPrimaryClip();
    if(clip==null || clip.getItemCount()==0){
      message("Clipboard empty. Copy text in ChatGPT first.");return;
    }
    ClipDescription description=clip.getDescription();
    if(description==null || !(description.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN) ||
        description.hasMimeType(ClipDescription.MIMETYPE_TEXT_HTML))){
      message("Clipboard isn't text. Please copy text in ChatGPT.");return;
    }
    CharSequence value=clip.getItemAt(0).coerceToText(this);
    if(value==null || value.length()==0){
      message("No clipboard text available. Copy text again.");return;
    }
    input.setText(value);input.setSelection(0);
    message("Clipboard loaded. Review and tap Send to AI Council.");
  }
  private Intent shareIntent(String value){
    Intent send=new Intent(Intent.ACTION_SEND);
    send.setType("text/plain");
    send.putExtra(Intent.EXTRA_TEXT,value);
    return send;
  }
  private String reviewedText(){
    String s=input.getText().toString();
    if(s.trim().isEmpty())message("Nothing to send. Copy text first.");
    return s;
  }
  private void sendToCouncil(){
    String value=reviewedText();
    if(value.trim().isEmpty())return;
    if(value.length()>MAX_PROMPT){
      new AlertDialog.Builder(this).setTitle("Selection too long")
          .setMessage("The Council accepts up to "+MAX_PROMPT+" characters. Send only the first "+MAX_PROMPT+"?")
          .setPositiveButton("Send first part",(d,w)->launchPreferred(shareIntent(value.substring(0,MAX_PROMPT))))
          .setNegativeButton("Edit first",null).show();
      return;
    }
    launchPreferred(shareIntent(value));
  }
  private List<ResolveInfo> candidates(){
    PackageManager pm=getPackageManager();
    List<ResolveInfo> all=pm.queryIntentActivities(shareIntent("test"),PackageManager.MATCH_DEFAULT_ONLY);
    List<ResolveInfo> result=new ArrayList<>();
    for(ResolveInfo r:all){
      if(r.activityInfo==null || r.activityInfo.packageName.equals(getPackageName()))continue;
      String name=String.valueOf(r.loadLabel(pm)).toLowerCase(Locale.ROOT).trim();
      if(name.contains("moe ai council") || name.equals("ai council") ||
          name.contains("moe council"))result.add(r);
    }
    return result;
  }
  private ComponentName preferred(){
    SharedPreferences prefs=getSharedPreferences(PREFS,MODE_PRIVATE);
    ComponentName wanted=ComponentName.unflattenFromString(prefs.getString(TARGET_KEY,""));
    if(wanted==null)return null;
    for(ResolveInfo r:candidates()){
      ComponentName current=new ComponentName(r.activityInfo.packageName,r.activityInfo.name);
      if(wanted.equals(current))return wanted;
    }
    return null;
  }
  private void refreshDestination(){
    if(destination==null)return;
    if(preferred()!=null)destination.setText("✓ Council paired: direct handoff enabled");
    else{
      int matches=candidates().size();
      if(matches==1)destination.setText("✓ Installed Council detected: direct handoff ready");
      else if(matches>1)destination.setText("Several Council apps found. Use Find / remember.");
      else destination.setText("Council share target not detected. Android Share fallback ready.");
    }
  }
  private void launchPreferred(Intent send){
    ComponentName component=preferred();
    List<ResolveInfo> list=candidates();
    if(component==null && list.size()==1){
      ResolveInfo r=list.get(0);
      component=new ComponentName(r.activityInfo.packageName,r.activityInfo.name);
    }
    if(component!=null){
      try{
        send.setComponent(component);
        startActivity(send);
        message("Opened installed Council directly.");
        return;
      }catch(ActivityNotFoundException | SecurityException ex){
        getSharedPreferences(PREFS,MODE_PRIVATE).edit().remove(TARGET_KEY).apply();
        message("Council destination changed. Falling back to Android Share.");
      }
    }
    send.setComponent(null);
    launchChooser(send);
  }
  private void launchChooser(Intent send){
    try{
      startActivity(Intent.createChooser(send,"Choose Moe AI Council"));
      message("Select the installed Moe AI Council in Android Share.");
    }catch(ActivityNotFoundException e){
      message("No share targets found. Install Moe AI Council from the website.");
    }
  }
  private void shareWithChooser(){
    String value=reviewedText();
    if(value.trim().isEmpty())return;
    if(value.length()>MAX_PROMPT){
      message("Please shorten this selection to "+MAX_PROMPT+" characters first.");
      return;
    }
    launchChooser(shareIntent(value));
  }
  private void pairCouncil(){
    List<ResolveInfo> matches=candidates();
    if(matches.isEmpty()){
      new AlertDialog.Builder(this).setTitle("Council app not found")
        .setMessage("Install Moe AI Council with Chrome → Install app, then reopen the Bridge. You can still use Android Share manually.")
        .setPositiveButton("Open Council website",(d,w)->openWebsite())
        .setNegativeButton("Cancel",null).show();
      return;
    }
    String[] labels=new String[matches.size()];
    for(int i=0;i<matches.size();i++){
      ResolveInfo r=matches.get(i);
      labels[i]=r.loadLabel(getPackageManager())+" ("+r.activityInfo.packageName+")";
    }
    new AlertDialog.Builder(this).setTitle("Remember installed Council app")
      .setItems(labels,(dialog,position)->{
        ResolveInfo r=matches.get(position);
        ComponentName component=new ComponentName(r.activityInfo.packageName,r.activityInfo.name);
        getSharedPreferences(PREFS,MODE_PRIVATE).edit()
          .putString(TARGET_KEY,component.flattenToString()).apply();
        message("Council paired. Future sends skip Android Share.");
        refreshDestination();
      })
      .setNeutralButton("Forget pairing",(d,w)->{
        getSharedPreferences(PREFS,MODE_PRIVATE).edit().remove(TARGET_KEY).apply();
        refreshDestination();
      })
      .setNegativeButton("Cancel",null).show();
  }
  private void requestTile(){
    if(Build.VERSION.SDK_INT<33){
      message("Open Quick Settings → Edit → add Send to Moe.");return;
    }
    try{
      StatusBarManager bar=(StatusBarManager)getSystemService(Context.STATUS_BAR_SERVICE);
      if(bar==null)throw new IllegalStateException("Status bar not available");
      bar.requestAddTileService(new ComponentName(this,CouncilTileService.class),
        "Send to Moe",Icon.createWithResource(this,android.R.drawable.ic_menu_share),
        getMainExecutor(),result->{
          if(result==StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED ||
             result==StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED){
            message("Send to Moe tile is ready!");
          }else message("Tile not added. Use Quick Settings → Edit to add Send to Moe.");
        });
    }catch(Exception ex){
      message("Add the tile manually: Quick Settings → Edit → Send to Moe.");
    }
  }
  private void openWebsite(){
    try{
      startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://moe-ai-council.lovable.app/")));
    }catch(ActivityNotFoundException ex){message("No browser available.");}
  }
}
