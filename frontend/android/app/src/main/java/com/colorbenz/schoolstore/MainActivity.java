package com.colorbenz.schoolstore;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Only enable WebContents debugging in debug builds (Prompt 10)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
    }
}
