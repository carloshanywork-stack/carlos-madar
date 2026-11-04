package com.madar.rep.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(RepLocationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
