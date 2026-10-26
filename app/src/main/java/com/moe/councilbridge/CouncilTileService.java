package com.moe.councilbridge;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.TileService;

public class CouncilTileService extends TileService {
  @Override public void onClick() {
    super.onClick();
    Intent launch = new Intent(this, MainActivity.class)
        .putExtra(MainActivity.EXTRA_IMPORT_CLIPBOARD, true)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    if (Build.VERSION.SDK_INT >= 34) {
      PendingIntent pending = PendingIntent.getActivity(
          this, 77, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      startActivityAndCollapse(pending);
    } else {
      startActivityAndCollapse(launch);
    }
  }
}
