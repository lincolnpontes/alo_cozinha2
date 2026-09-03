package io.github.lincolnpontes.alocozinha;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

public class PrinterBridge {
    private static final int CONNECT_TIMEOUT_MS = 8000;
    private static final int WRITE_TIMEOUT_MS = 12000;

    @JavascriptInterface
    public String testConnection(String host, int port) {
        try {
            validateEndpoint(host, port);
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
            }
            return ok();
        } catch (Exception e) {
            return error(e);
        }
    }

    @JavascriptInterface
    public String sendRawText(String text, String host, int port) {
        try {
            validateEndpoint(host, port);
            byte[] bytes = String.valueOf(text).getBytes(StandardCharsets.ISO_8859_1);
            sendBytes(host, port, bytes);
            return ok();
        } catch (Exception e) {
            return error(e);
        }
    }

    @JavascriptInterface
    public String sendRawTextBatch(String jsonCommands, String host, int port, int delayMs) {
        int sent = 0;
        try {
            validateEndpoint(host, port);
            JSONArray commands = new JSONArray(jsonCommands == null ? "[]" : jsonCommands);
            if (commands.length() == 0) {
                throw new IllegalArgumentException("Lote de impressao vazio.");
            }
            int normalizedDelay = Math.max(100, Math.min(1500, delayMs));
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
                socket.setSoTimeout(WRITE_TIMEOUT_MS);
                socket.setTcpNoDelay(true);
                OutputStream output = socket.getOutputStream();
                for (int index = 0; index < commands.length(); index++) {
                    byte[] bytes = commands.getString(index).getBytes(StandardCharsets.ISO_8859_1);
                    output.write(bytes);
                    output.flush();
                    sent++;
                    if (index + 1 < commands.length()) {
                        Thread.sleep(normalizedDelay);
                    }
                }
                Thread.sleep(250L);
            }
            return "{\"ok\":true,\"enviadas\":" + sent + "}";
        } catch (Exception e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return error(e, sent);
        }
    }

    @JavascriptInterface
    public String printPngBase64(String base64Png, String host, int port, int widthDots, int heightDots, int gapDots, int offsetDots, String mediaMode) {
        try {
            validateEndpoint(host, port);
            if (base64Png == null || base64Png.trim().isEmpty()) {
                throw new IllegalArgumentException("Imagem da etiqueta vazia.");
            }

            byte[] png = Base64.decode(base64Png, Base64.DEFAULT);
            Bitmap decoded = BitmapFactory.decodeByteArray(png, 0, png.length);
            if (decoded == null) {
                throw new IllegalArgumentException("Nao foi possivel ler a imagem da etiqueta.");
            }

            int targetWidth = widthDots > 0 ? widthDots : decoded.getWidth();
            int targetHeight = heightDots > 0 ? heightDots : decoded.getHeight();
            Bitmap bitmap = decoded;
            if (decoded.getWidth() != targetWidth || decoded.getHeight() != targetHeight) {
                bitmap = Bitmap.createScaledBitmap(decoded, targetWidth, targetHeight, true);
                decoded.recycle();
            }

            byte[] epl = buildEplGraphic(bitmap, targetWidth, targetHeight, gapDots, offsetDots, mediaMode);
            if (!bitmap.isRecycled()) {
                bitmap.recycle();
            }

            sendBytes(host, port, epl);
            return ok();
        } catch (Exception e) {
            return error(e);
        }
    }

    private byte[] buildEplGraphic(Bitmap bitmap, int width, int height, int gapDots, int offsetDots, String mediaMode) throws IOException {
        int bytesPerRow = (width + 7) / 8;
        byte[] raster = toMonochromeRaster(bitmap, width, height, bytesPerRow);

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        writeAscii(out, "N\r\n");
        writeAscii(out, "R0,0\r\n");
        writeAscii(out, "q" + width + "\r\n");
        writeAscii(out, buildQCommand(height, gapDots, offsetDots, mediaMode) + "\r\n");
        writeAscii(out, "ZT\r\n");
        writeAscii(out, "JF\r\n");
        writeAscii(out, "D10\r\n");
        writeAscii(out, "S4\r\n");
        writeAscii(out, "GW0,0," + bytesPerRow + "," + height + ",");
        out.write(raster);
        writeAscii(out, "\r\nP1\r\n");
        return out.toByteArray();
    }

    private String buildQCommand(int height, int gapDots, int offsetDots, String mediaMode) {
        String mode = mediaMode == null ? "gap" : mediaMode.trim().toLowerCase();
        if ("continuous".equals(mode)) {
            return "Q" + height + ",0";
        }

        int normalizedGap = Math.max(16, Math.min(240, gapDots));
        int normalizedOffset = Math.max(-240, Math.min(240, offsetDots));
        String gapPart = ("black".equals(mode) ? "B" : "") + normalizedGap;
        String offsetPart = "";
        if (normalizedOffset > 0) {
            offsetPart = "+" + normalizedOffset;
        } else if (normalizedOffset < 0) {
            offsetPart = String.valueOf(normalizedOffset);
        }
        return "Q" + height + "," + gapPart + offsetPart;
    }

    private byte[] toMonochromeRaster(Bitmap bitmap, int width, int height, int bytesPerRow) {
        byte[] raster = new byte[bytesPerRow * height];
        int index = 0;
        for (int y = 0; y < height; y++) {
            int current = 0;
            int bit = 7;
            for (int x = 0; x < width; x++) {
                int pixel = bitmap.getPixel(x, y);
                int alpha = (pixel >>> 24) & 0xff;
                int red = (pixel >>> 16) & 0xff;
                int green = (pixel >>> 8) & 0xff;
                int blue = pixel & 0xff;
                int luminance = (red * 299 + green * 587 + blue * 114) / 1000;
                if (alpha > 80 && luminance < 185) {
                    current |= (1 << bit);
                }
                bit--;
                if (bit < 0) {
                    raster[index++] = (byte) current;
                    current = 0;
                    bit = 7;
                }
            }
            if (bit != 7) {
                raster[index++] = (byte) current;
            }
        }
        return raster;
    }

    private void sendBytes(String host, int port, byte[] bytes) throws IOException {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
            socket.setSoTimeout(WRITE_TIMEOUT_MS);
            socket.setTcpNoDelay(true);
            OutputStream output = socket.getOutputStream();
            output.write(bytes);
            output.flush();
            try {
                Thread.sleep(250L);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private void validateEndpoint(String host, int port) {
        if (host == null || host.trim().isEmpty()) {
            throw new IllegalArgumentException("IP da impressora nao informado.");
        }
        if (port <= 0 || port > 65535) {
            throw new IllegalArgumentException("Porta da impressora invalida.");
        }
    }

    private void writeAscii(ByteArrayOutputStream out, String value) throws IOException {
        out.write(value.getBytes(StandardCharsets.US_ASCII));
    }

    private String ok() {
        return "{\"ok\":true}";
    }

    private String error(Exception e) {
        return error(e, 0);
    }

    private String error(Exception e, int sent) {
        String message = e.getMessage();
        if (message == null || message.trim().isEmpty()) {
            message = e.getClass().getSimpleName();
        }
        return "{\"ok\":false,\"enviadas\":" + sent + ",\"error\":" + JSONObject.quote(message) + "}";
    }
}
