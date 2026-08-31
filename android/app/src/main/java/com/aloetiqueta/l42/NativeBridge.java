package com.aloetiqueta.l42;

import android.Manifest;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class NativeBridge {
    private final MainActivity activity;

    NativeBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String openQrScanner() {
        activity.openNativeScanner();
        return ok();
    }

    @JavascriptInterface
    public String resumeQrScanner() {
        activity.resumeNativeScanner();
        return ok();
    }

    @JavascriptInterface
    public String closeQrScanner() {
        activity.closeNativeScanner(false);
        return ok();
    }

    @JavascriptInterface
    public String setSystemBars(String color) {
        activity.setSystemBarsColor(color);
        return ok();
    }

    @JavascriptInterface
    public String openWhatsApp(String phone, String text) {
        try {
            String digits = phone == null ? "" : phone.replaceAll("\\D", "");
            if (digits.length() == 10 || digits.length() == 11) {
                digits = "55" + digits;
            }
            String url = "https://wa.me/" + digits + "?text=" + Uri.encode(text == null ? "" : text);
            activity.runOnUiThread(() -> {
                Intent whatsapp = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                whatsapp.setPackage("com.whatsapp");
                try {
                    activity.startActivity(whatsapp);
                } catch (Exception unavailable) {
                    try {
                        activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) {}
                }
            });
            return ok();
        } catch (Exception e) {
            return error(e);
        }
    }

    @JavascriptInterface
    public String savePngToGallery(String base64Png, String requestedName) {
        try {
            if (base64Png == null || base64Png.trim().isEmpty()) {
                throw new IllegalArgumentException("Imagem vazia.");
            }
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P
                    && activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                activity.requestStoragePermission();
                throw new IllegalStateException("Autorize o acesso aos arquivos e toque em imprimir novamente.");
            }

            byte[] png = Base64.decode(base64Png, Base64.DEFAULT);
            String name = sanitizeName(requestedName);
            ContentResolver resolver = activity.getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");

            Uri collection;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Alo Etiqueta");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
                collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            } else {
                File folder = new File(
                        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                        "Alo Etiqueta"
                );
                if (!folder.exists() && !folder.mkdirs()) {
                    throw new IllegalStateException("Nao foi possivel criar a pasta da Galeria.");
                }
                values.put(MediaStore.Images.Media.DATA, new File(folder, name).getAbsolutePath());
                collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            }

            Uri uri = resolver.insert(collection, values);
            if (uri == null) {
                throw new IllegalStateException("A Galeria recusou a imagem.");
            }

            try (OutputStream output = resolver.openOutputStream(uri)) {
                if (output == null) {
                    throw new IllegalStateException("Nao foi possivel gravar a imagem.");
                }
                output.write(png);
                output.flush();
            } catch (Exception e) {
                resolver.delete(uri, null, null);
                throw e;
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues ready = new ContentValues();
                ready.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(uri, ready, null, null);
            }
            return "{\"ok\":true,\"uri\":" + JSONObject.quote(uri.toString())
                    + ",\"name\":" + JSONObject.quote(name) + "}";
        } catch (Exception e) {
            return error(e);
        }
    }

    @JavascriptInterface
    public String saveDocumentBase64(String base64Data, String mimeType, String requestedName) {
        try {
            if (base64Data == null || base64Data.trim().isEmpty()) {
                throw new IllegalArgumentException("Arquivo vazio.");
            }
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P
                    && activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                activity.requestStoragePermission();
                throw new IllegalStateException("Autorize o acesso aos arquivos e tente novamente.");
            }

            byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
            String name = sanitizeDocumentName(requestedName);
            String safeMime = mimeType == null || mimeType.trim().isEmpty()
                    ? "application/octet-stream"
                    : mimeType.trim();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = activity.getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, safeMime);
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Alo Etiqueta");
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = resolver.insert(
                        MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                        values
                );
                if (uri == null) {
                    throw new IllegalStateException("A pasta Downloads recusou o arquivo.");
                }
                try (OutputStream output = resolver.openOutputStream(uri)) {
                    if (output == null) {
                        throw new IllegalStateException("Nao foi possivel gravar o arquivo.");
                    }
                    output.write(data);
                    output.flush();
                } catch (Exception e) {
                    resolver.delete(uri, null, null);
                    throw e;
                }
                ContentValues ready = new ContentValues();
                ready.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(uri, ready, null, null);
                return "{\"ok\":true,\"uri\":" + JSONObject.quote(uri.toString())
                        + ",\"name\":" + JSONObject.quote(name) + "}";
            }

            File folder = new File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                    "Alo Etiqueta"
            );
            if (!folder.exists() && !folder.mkdirs()) {
                throw new IllegalStateException("Nao foi possivel criar a pasta Downloads.");
            }
            File file = new File(folder, name);
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(data);
                output.flush();
            }
            return "{\"ok\":true,\"uri\":" + JSONObject.quote(Uri.fromFile(file).toString())
                    + ",\"name\":" + JSONObject.quote(name) + "}";
        } catch (Exception e) {
            return error(e);
        }
    }

    @JavascriptInterface
    public String shareDocumentBase64(String base64Data, String mimeType, String requestedName, String title) {
        try {
            String result = saveDocumentBase64(base64Data, mimeType, requestedName);
            JSONObject saved = new JSONObject(result);
            if (!saved.optBoolean("ok", false)) return result;
            Uri uri = Uri.parse(saved.getString("uri"));
            String safeMime = mimeType == null || mimeType.trim().isEmpty() ? "application/octet-stream" : mimeType.trim();
            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType(safeMime);
            share.putExtra(Intent.EXTRA_STREAM, uri);
            share.setClipData(ClipData.newUri(activity.getContentResolver(), saved.optString("name", "Alô Etiqueta"), uri));
            share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.runOnUiThread(() -> activity.startActivity(Intent.createChooser(share, title == null ? "Compartilhar arquivo" : title)));
            return result;
        } catch (Exception e) {
            return error(e);
        }
    }
    private String sanitizeName(String requestedName) {
        String name = requestedName == null ? "Alo-Etiqueta.png" : requestedName.trim();
        name = name.replaceAll("[\\\\/:*?\"<>|\\r\\n]+", "-");
        if (!name.toLowerCase().endsWith(".png")) {
            name += ".png";
        }
        if (name.length() > 96) {
            name = name.substring(0, 92) + ".png";
        }
        return name;
    }

    private String sanitizeDocumentName(String requestedName) {
        String name = requestedName == null ? "Alo-Etiqueta.bin" : requestedName.trim();
        name = name.replaceAll("[\\\\/:*?\"<>|\\r\\n]+", "-");
        if (name.isEmpty()) {
            name = "Alo-Etiqueta.bin";
        }
        if (name.length() > 120) {
            int dot = name.lastIndexOf('.');
            String extension = dot > 0 && name.length() - dot <= 12 ? name.substring(dot) : "";
            name = name.substring(0, Math.max(1, 120 - extension.length())) + extension;
        }
        return name;
    }

    private String ok() {
        return "{\"ok\":true}";
    }

    private String error(Exception e) {
        String message = e.getMessage();
        if (message == null || message.trim().isEmpty()) {
            message = e.getClass().getSimpleName();
        }
        return "{\"ok\":false,\"error\":" + JSONObject.quote(message) + "}";
    }
}
