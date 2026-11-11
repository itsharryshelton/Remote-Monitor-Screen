package dev.rms.monitor;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.UiModeManager;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.text.InputType;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Kiosk wrapper for the Remote Monitor Screen dashboard.
 * Loads the dashboard from the PC; if the PC cannot be reached, shows a bundled clock
 * (no network needed) and probes the PC every few seconds until it is back.
 * Also runs on Android TV / Google TV: the page is told via RmsNative.isTv() and handles the remote's
 * D-pad itself; Back goes to the page first (to close a card) and opens settings otherwise.
 */
public class MainActivity extends Activity {
    private static final String CLOCK_URL = "file:///android_asset/clock.html";
    private static final long PROBE_MS = 10_000;
    // Windows Firewall silently drops packets to a closed port, so a load can hang instead of failing.
    private static final long LOAD_TIMEOUT_MS = 10_000;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private SharedPreferences prefs;
    private FrameLayout root;
    private WebView web;
    private boolean showingClock = false;
    private boolean probing = false;
    private boolean dashboardLoaded = false;
    private int loadGeneration = 0;
    private boolean tv = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("rms", MODE_PRIVATE);
        UiModeManager modes = getSystemService(UiModeManager.class);
        tv = modes != null && modes.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        CookieManager.getInstance().setAcceptCookie(true);
        createWebView();
        loadDashboard();
    }

    private void createWebView() {
        if (web != null) {
            root.removeView(web);
            web.destroy();
        }
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false); // android_asset still works; arbitrary files do not
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        web.addJavascriptInterface(new Bridge(), "RmsNative");
        web.setWebViewClient(new Client());
        // The TV remote's D-pad only reaches the page while the WebView holds focus.
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        root.addView(web, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        web.requestFocus();
    }

    private String serverUrl() {
        String url = prefs.getString("url", getString(R.string.default_url));
        return url.replaceAll("/+$", "");
    }

    /** Check the PC is reachable first (short timeout), then load; otherwise show the clock. */
    private void loadDashboard() {
        final String url = serverUrl();
        final int gen = ++loadGeneration;
        io.execute(() -> {
            final boolean ok = ping(url);
            ui.post(() -> {
                if (gen != loadGeneration) return;
                if (!ok) {
                    if (showingClock) startProbe(); // already on the clock: keep retrying
                    else showClock("PC offline");
                    return;
                }
                showingClock = false;
                probing = false;
                dashboardLoaded = false;
                web.loadUrl(url + "/");
                ui.postDelayed(() -> {
                    if (gen == loadGeneration && !showingClock && !dashboardLoaded) {
                        web.stopLoading();
                        showClock("PC not responding");
                    }
                }, LOAD_TIMEOUT_MS);
            });
        });
    }

    private void showClock(String msg) {
        if (showingClock) return;
        showingClock = true;
        loadGeneration++;
        web.loadUrl(CLOCK_URL + "?msg=" + Uri.encode(msg));
        startProbe();
    }

    private void startProbe() {
        if (probing) return;
        probing = true;
        ui.postDelayed(probe, PROBE_MS);
    }

    private final Runnable probe = new Runnable() {
        @Override
        public void run() {
            final String url = serverUrl();
            io.execute(() -> {
                final boolean ok = ping(url);
                ui.post(() -> {
                    if (!showingClock) {
                        probing = false;
                    } else if (ok) {
                        probing = false;
                        loadDashboard();
                    } else {
                        ui.postDelayed(probe, PROBE_MS);
                    }
                });
            });
        }
    };

    private static boolean ping(String base) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(base + "/api/ping").openConnection();
            c.setConnectTimeout(3000);
            c.setReadTimeout(3000);
            c.setUseCaches(false);
            int code = c.getResponseCode();
            return code >= 200 && code < 400;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private boolean isAllowed(Uri u) {
        if (u == null) return false;
        String s = u.toString();
        if (s.startsWith("file:///android_asset/")) return true;
        Uri base = Uri.parse(serverUrl());
        return eq(u.getScheme(), base.getScheme()) && eq(u.getHost(), base.getHost()) && u.getPort() == base.getPort();
    }

    private static boolean eq(String a, String b) {
        return a == null ? b == null : a.equalsIgnoreCase(b);
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // Stay on the dashboard; never open other sites inside the kiosk.
            return !isAllowed(request.getUrl());
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (url != null && !url.startsWith("file:")) dashboardLoaded = true;
            if (!view.hasFocus()) view.requestFocus();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && !showingClock) ui.post(() -> showClock("PC offline"));
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse resp) {
            if (request.isForMainFrame() && resp.getStatusCode() >= 500 && !showingClock) {
                ui.post(() -> showClock("PC not responding"));
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // WebView renderer crashed or was killed for memory: rebuild and carry on.
            ui.post(() -> {
                createWebView();
                loadDashboard();
            });
            return true;
        }
    }

    /** Exposed to page JavaScript as window.RmsNative. Only vibrate, nothing sensitive. */
    private class Bridge {
        @JavascriptInterface
        public void vibrate(long ms) {
            Vibrator v = getSystemService(Vibrator.class);
            if (v != null && v.hasVibrator()) {
                v.vibrate(VibrationEffect.createOneShot(Math.max(10, Math.min(ms, 1000)), VibrationEffect.DEFAULT_AMPLITUDE));
            }
        }

        @JavascriptInterface
        public boolean isApp() {
            return true;
        }

        @JavascriptInterface
        public boolean isTv() {
            return tv;
        }
    }

    @Override
    public void onBackPressed() {
        // Let the page close whatever is open (a session card, a focus ring) before showing settings.
        if (showingClock) { showSettings(); return; }
        web.evaluateJavascript("(function(){try{return !!(window.RmsKeys&&window.RmsKeys.back());}catch(e){return false;}})()",
            v -> { if (!"true".equals(v)) showSettings(); });
    }

    private void showSettings() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(serverUrl());
        input.setSelectAllOnFocus(true);
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Dashboard address")
            .setMessage("Address of the PC running Remote Monitor Screen.")
            .setView(input)
            .setPositiveButton("Save", (d, w) -> {
                String v = input.getText().toString().trim();
                if (!v.isEmpty()) {
                    if (!v.startsWith("http://") && !v.startsWith("https://")) v = "http://" + v;
                    prefs.edit().putString("url", v).apply();
                }
                loadDashboard();
            })
            .setNeutralButton("Reload", (d, w) -> loadDashboard())
            .setNegativeButton("Exit", (d, w) -> finish())
            .setOnDismissListener(d -> { hideSystemUi(); web.requestFocus(); })
            .show();
    }

    private void hideSystemUi() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        if (showingClock) startProbe();
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        io.shutdownNow();
        web.destroy();
        super.onDestroy();
    }
}
