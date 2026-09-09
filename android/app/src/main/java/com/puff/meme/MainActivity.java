package com.puff.meme;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(BackupExportPlugin.class);
        registerPlugin(FloatingWindowPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
