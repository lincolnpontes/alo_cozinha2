package com.aloetiqueta.l42;

import android.app.AlertDialog;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.ConsoleMessage;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.ComponentActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

public class MainActivity extends ComponentActivity {
    static final int CAMERA_PERMISSION_REQUEST = 42;
    static final int STORAGE_PERMISSION_REQUEST = 43;
    static final int FILE_CHOOSER_REQUEST = 44;
    private static final int DEFAULT_SYSTEM_BAR_COLOR = Color.rgb(21, 101, 192);

    private FrameLayout rootLayout;
    private WebView webView;
    private NativeQrScanner nativeScanner;
    private boolean scannerRequested;
    private int systemBarColor = DEFAULT_SYSTEM_BAR_COLOR;
    private ValueCallback<Uri[]> fileChooserCallback;
    private String pendingAuthUrl;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWindow();

        rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(systemBarColor);
        applySystemBarPadding(rootLayout);

        webView = new WebView(this);
        rootLayout.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        setContentView(rootLayout);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
            rootLayout.requestApplyInsets();
        } else {
            applyFallbackPadding(rootLayout, 0, 0, 0, 0);
        }

        configureWebView();
        webView.addJavascriptInterface(new PrinterBridge(), "AloPrinter");
        webView.addJavascriptInterface(new NativeBridge(this), "AloNative");
        captureAuthIntent(getIntent());
        webView.loadUrl("file:///android_asset/index.html");
    }

    void openNativeScanner() {
        runOnUiThread(() -> {
            scannerRequested = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
                return;
            }
            showNativeScanner();
        });
    }

    void resumeNativeScanner() {
        runOnUiThread(() -> {
            if (nativeScanner != null) {
                nativeScanner.resumeScanning();
            }
        });
    }

    void closeNativeScanner(boolean notifyWeb) {
        runOnUiThread(() -> {
            NativeQrScanner scanner = nativeScanner;
            nativeScanner = null;
            scannerRequested = false;
            if (scanner != null) {
                scanner.close();
            }
            if (notifyWeb) {
                dispatchJavascript("window.cameraNativaFechada&&window.cameraNativaFechada()");
            }
        });
    }

    void requestStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Build.VERSION.SDK_INT <= Build.VERSION_CODES.P
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            runOnUiThread(() -> requestPermissions(
                    new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                    STORAGE_PERMISSION_REQUEST
            ));
        }
    }

    private void showNativeScanner() {
        if (nativeScanner != null) {
            nativeScanner.resumeScanning();
            return;
        }
        nativeScanner = new NativeQrScanner(
                this,
                rootLayout,
                this::dispatchQrsToWeb,
                () -> {
                    nativeScanner = null;
                    scannerRequested = false;
                    dispatchJavascript("window.cameraNativaFechada&&window.cameraNativaFechada()");
                }
        );
        nativeScanner.open();
    }

    private void dispatchQrsToWeb(List<String> values) {
        JSONArray payload = new JSONArray();
        if (values != null) {
            for (String value : values) {
                if (value != null && !value.trim().isEmpty()) {
                    payload.put(value.trim());
                }
            }
        }
        dispatchJavascript("window.receberQrsNativos&&window.receberQrsNativos(" + payload + ")");
    }

    private void dispatchJavascript(String script) {
        if (webView == null) {
            return;
        }
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_PERMISSION_REQUEST && scannerRequested) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                showNativeScanner();
            } else {
                scannerRequested = false;
                Toast.makeText(this, "A camera precisa de permissao para ler etiquetas.", Toast.LENGTH_LONG).show();
                dispatchJavascript("window.cameraNativaFechada&&window.cameraNativaFechada()");
            }
        }
    }

    private void configureWindow() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(true);
        }
        applySystemBarColor(systemBarColor);
    }

    void setSystemBarsColor(String cssColor) {
        runOnUiThread(() -> {
            try {
                systemBarColor = Color.parseColor(cssColor);
            } catch (Exception ignored) {
                systemBarColor = DEFAULT_SYSTEM_BAR_COLOR;
            }
            applySystemBarColor(systemBarColor);
        });
    }

    private void applySystemBarColor(int color) {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.setStatusBarColor(color);
            window.setNavigationBarColor(Color.BLACK);
        }
        if (rootLayout != null) {
            rootLayout.setBackgroundColor(color);
        }
    }

    private void applySystemBarPadding(FrameLayout view) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
            view.setOnApplyWindowInsetsListener((v, insets) -> {
                int left;
                int top;
                int right;
                int bottom;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                    left = bars.left;
                    top = bars.top;
                    right = bars.right;
                    bottom = bars.bottom;
                } else {
                    left = insets.getSystemWindowInsetLeft();
                    top = insets.getSystemWindowInsetTop();
                    right = insets.getSystemWindowInsetRight();
                    bottom = insets.getSystemWindowInsetBottom();
                }
                applyFallbackPadding(v, left, top, right, bottom);
                return insets;
            });
        } else {
            view.setFitsSystemWindows(true);
        }
    }

    private void applyFallbackPadding(android.view.View view, int left, int top, int right, int bottom) {
        view.setPadding(left, top, right, bottom);
    }

    private void configureWebView() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(false);
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            settings.setAllowFileAccessFromFileURLs(true);
            settings.setAllowUniversalAccessFromFileURLs(true);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                dispatchPendingAuthUrl();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleExternalUrl(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleExternalUrl(Uri.parse(url));
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    runOnUiThread(() -> {
                        for (String resource : request.getResources()) {
                            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                                    && request.getOrigin() != null
                                    && "file".equals(request.getOrigin().getScheme())) {
                                request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                                return;
                            }
                        }
                        request.deny();
                    });
                }
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setTitle("Alô Cozinha").setMessage(message).setPositiveButton("OK", (dialog, which) -> result.confirm()).setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setTitle("Alô Cozinha").setMessage(message).setNegativeButton("Cancelar", (dialog, which) -> result.cancel()).setPositiveButton("Confirmar", (dialog, which) -> result.confirm()).setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                return true;
            }

            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                }
                fileChooserCallback = filePathCallback;
                try {
                    Intent intent = fileChooserParams.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileChooserCallback = null;
                    Toast.makeText(MainActivity.this, "Nenhum seletor de arquivos foi encontrado.", Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileChooserCallback != null) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileChooserCallback.onReceiveValue(result);
            fileChooserCallback = null;
        }
    }

    private boolean handleExternalUrl(Uri uri) {
        if (uri == null) {
            return true;
        }
        String scheme = uri.getScheme();
        if (scheme == null || "file".equals(scheme) || "about".equals(scheme)) {
            return false;
        }
        if ("aloetiqueta".equals(scheme)) {
            pendingAuthUrl = uri.toString();
            dispatchPendingAuthUrl();
            return true;
        }

        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Nao foi possivel abrir este link.", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void captureAuthIntent(Intent intent) {
        Uri uri = intent == null ? null : intent.getData();
        if (uri != null && "aloetiqueta".equals(uri.getScheme()) && "auth".equals(uri.getHost())) {
            pendingAuthUrl = uri.toString();
        }
    }

    private void dispatchPendingAuthUrl() {
        if (webView == null || pendingAuthUrl == null) {
            return;
        }
        String url = pendingAuthUrl;
        pendingAuthUrl = null;
        dispatchJavascript("window.receberLinkAutenticacaoSupabase&&window.receberLinkAutenticacaoSupabase("
                + JSONObject.quote(url) + ")");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureAuthIntent(intent);
        dispatchPendingAuthUrl();
    }

    @Override
    public void onBackPressed() {
        if (nativeScanner != null) {
            closeNativeScanner(true);
            return;
        }
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(function(){if(window.AloModuleHost&&window.AloModuleHost.active()!=='home'){window.AloModuleHost.showHome();return true;}return false;})()",
                handled -> {
                    if (!"true".equals(handled)) runOnUiThread(super::onBackPressed);
                }
        );
    }

    @Override
    protected void onDestroy() {
        closeNativeScanner(false);
        if (fileChooserCallback != null) {
            fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
