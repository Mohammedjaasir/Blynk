package lk.blynk.ops;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * In-app updates (owner, 2026-10-12). The web side (src/lib/app-update.ts)
 * reads the published manifest https://blynk.lk/download/<app>.json and asks
 * this plugin to fetch and install the new APK. Android's own install screen
 * opens; the user taps Install and keeps their data and sign-in.
 *
 * Safety: the APK URL is fixed here - this app only ever installs its own
 * APK (APP_NAME); no URL is accepted from JavaScript or the server. The
 * download is capped at the expected size, its SHA-256 must match the
 * manifest, and its package name and signing certificate must match the
 * installed app (Android also refuses an update signed by another key).
 * Partial or failed downloads are deleted.
 *
 * Methods: getInstalledVersion() -> {versionCode, versionName};
 * canRequestInstall() -> {allowed}; openInstallSettings();
 * downloadAndInstall({expectedSha256, size}) -> {status: "installing"}, with
 * "downloadProgress" events {downloaded, total}. Rejection codes: BUSY,
 * BAD_INPUT, INSTALL_PERMISSION, NETWORK, SIZE_MISMATCH, CHECKSUM_MISMATCH,
 * INVALID_APK, SIGNATURE_MISMATCH, INSTALL_FAILED.
 *
 * This file is the same in apps/operations and apps/rider apart from the
 * package line and APP_NAME. Registered in MainActivity.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    /** The only APK this app installs: https://blynk.lk/download/ops.apk */
    static final String APP_NAME = "ops";
    static final String APK_URL = "https://blynk.lk/download/" + APP_NAME + ".apk";
    static final long MAX_APK_BYTES = 200L * 1024 * 1024;
    static final String APK_MIME = "application/vnd.android.package-archive";
    private static final String UPDATE_DIR = "app-update";
    private static final long STALE_MS = 60L * 60 * 1000;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean busy = false;

    @Override
    public void load() {
        // An APK left from an earlier update (the installer has finished with it).
        File dir = updateDir();
        File[] files = dir.listFiles();
        if (files == null) return;
        long now = System.currentTimeMillis();
        for (File f : files) {
            if (now - f.lastModified() > STALE_MS) f.delete();
        }
    }

    @PluginMethod
    public void getInstalledVersion(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
            JSObject ret = new JSObject();
            ret.put("versionCode", code);
            ret.put("versionName", info.versionName == null ? "" : info.versionName);
            call.resolve(ret);
        } catch (PackageManager.NameNotFoundException e) {
            call.reject("Could not read the installed version", "UNKNOWN", e);
        }
    }

    @PluginMethod
    public void canRequestInstall(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("allowed", installAllowed());
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Context ctx = getContext();
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
        } else {
            intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the install settings", "UNKNOWN", e);
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String expected = call.getString("expectedSha256", "");
        final String expectedSha256 = expected == null ? "" : expected.trim().toLowerCase(Locale.ROOT);
        Object rawSize = call.getData().opt("size");
        final long size = rawSize instanceof Number ? ((Number) rawSize).longValue() : -1;
        if (!expectedSha256.matches("[0-9a-f]{64}") || size <= 0 || size > MAX_APK_BYTES) {
            call.reject("The update details are not valid", "BAD_INPUT");
            return;
        }
        if (!installAllowed()) {
            call.reject("Allow this app to install updates first", "INSTALL_PERMISSION");
            return;
        }
        synchronized (this) {
            if (busy) {
                call.reject("An update is already downloading", "BUSY");
                return;
            }
            busy = true;
        }
        executor.execute(() -> {
            File apk = new File(updateDir(), APP_NAME + "-update.apk");
            try {
                if (apk.exists()) apk.delete();
                String actualSha = download(apk, size);
                if (!actualSha.equals(expectedSha256)) {
                    fail(call, apk, "The download was corrupted", "CHECKSUM_MISMATCH");
                    return;
                }
                String problem = checkPackage(apk);
                if (problem != null) {
                    fail(call, apk, problem.equals("SIGNATURE_MISMATCH")
                        ? "This update is not signed by Blynk" : "The downloaded file is not a valid update", problem);
                    return;
                }
                openInstaller(apk);
                JSObject ret = new JSObject();
                ret.put("status", "installing");
                call.resolve(ret);
            } catch (SizeException e) {
                fail(call, apk, "The download was corrupted", "SIZE_MISMATCH");
            } catch (IOException e) {
                fail(call, apk, "Could not download the update. Check your connection and try again.", "NETWORK");
            } catch (Exception e) {
                fail(call, apk, "Could not open the installer", "INSTALL_FAILED");
            } finally {
                busy = false;
            }
        });
    }

    private boolean installAllowed() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    /** Android 7+: app cache via FileProvider. Android 6: the external cache (the installer needs a file:// it can read). */
    private File updateDir() {
        File base = getContext().getCacheDir();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N && getContext().getExternalCacheDir() != null) {
            base = getContext().getExternalCacheDir();
        }
        File dir = new File(base, UPDATE_DIR);
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private static class SizeException extends IOException {
        SizeException() {
            super("size");
        }
    }

    /** Streams APK_URL into `target`, never more than `size` bytes. Returns the SHA-256 (hex). */
    private String download(File target, long size) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(APK_URL).openConnection();
        conn.setConnectTimeout(20_000);
        conn.setReadTimeout(30_000);
        conn.setInstanceFollowRedirects(true);
        conn.setRequestProperty("Cache-Control", "no-cache");
        try {
            int status = conn.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK || !"https".equals(conn.getURL().getProtocol())) {
                throw new IOException("HTTP " + status);
            }
            long announced = conn.getContentLengthLong();
            if (announced >= 0 && announced != size) throw new SizeException();
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long downloaded = 0;
            int lastPercent = -1;
            byte[] buffer = new byte[64 * 1024];
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(target)) {
                int n;
                while ((n = in.read(buffer)) != -1) {
                    downloaded += n;
                    if (downloaded > size) throw new SizeException();
                    digest.update(buffer, 0, n);
                    out.write(buffer, 0, n);
                    int percent = (int) (downloaded * 100 / size);
                    if (percent != lastPercent) {
                        lastPercent = percent;
                        JSObject progress = new JSObject();
                        progress.put("downloaded", downloaded);
                        progress.put("total", size);
                        notifyListeners("downloadProgress", progress);
                    }
                }
            }
            if (downloaded != size) throw new SizeException();
            StringBuilder hex = new StringBuilder();
            for (byte b : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", b));
            return hex.toString();
        } finally {
            conn.disconnect();
        }
    }

    /** null when the APK is this app, signed with the installed app's key; else an error code. */
    @SuppressWarnings("deprecation")
    private String checkPackage(File apk) {
        PackageManager pm = getContext().getPackageManager();
        String pkg = getContext().getPackageName();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (archive == null || !pkg.equals(archive.packageName)) return "INVALID_APK";
        try {
            Set<String> installed = signers(pm.getPackageInfo(pkg, flags));
            Set<String> downloaded = signers(archive);
            // Signatures that cannot be read are left to Android's own same-signer check.
            if (!installed.isEmpty() && !downloaded.isEmpty() && !installed.equals(downloaded)) return "SIGNATURE_MISMATCH";
        } catch (Exception e) {
            return null;
        }
        return null;
    }

    @SuppressWarnings("deprecation")
    private static Set<String> signers(PackageInfo info) throws Exception {
        Signature[] sigs = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (info.signingInfo != null) sigs = info.signingInfo.getApkContentsSigners();
        } else {
            sigs = info.signatures;
        }
        Set<String> out = new HashSet<>();
        if (sigs == null) return out;
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        for (Signature s : sigs) {
            StringBuilder hex = new StringBuilder();
            for (byte b : md.digest(s.toByteArray())) hex.append(String.format(Locale.ROOT, "%02x", b));
            out.add(hex.toString());
        }
        return out;
    }

    private void openInstaller(File apk) {
        Context ctx = getContext();
        Uri uri = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
            ? FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk)
            : Uri.fromFile(apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, APK_MIME);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(intent);
    }

    private void fail(PluginCall call, File apk, String message, String code) {
        if (apk.exists()) apk.delete();
        call.reject(message, code);
    }
}
