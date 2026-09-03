package io.github.lincolnpontes.alocozinha;

import android.annotation.SuppressLint;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.media.Image;
import android.util.Size;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.ZoomSuggestionOptions;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

final class NativeQrScanner {
    private final MainActivity activity;
    private final FrameLayout host;
    private static final long QR_COLLECTION_WINDOW_MS = 650L;

    private final Consumer<List<String>> resultListener;
    private final Runnable closeListener;
    private final FrameLayout overlay;
    private final PreviewView previewView;
    private final TextView statusView;
    private final TextView torchButton;
    private final BarcodeScanner barcodeScanner;
    private final ExecutorService analyzerExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean processing = new AtomicBoolean(false);
    private final Set<String> pendingValues = new LinkedHashSet<>();

    private ProcessCameraProvider cameraProvider;
    private Camera camera;
    private boolean paused;
    private boolean closed;
    private boolean torchEnabled;
    private boolean collectionScheduled;
    private int collectionGeneration;
    private float pinchStartZoom = 1f;

    NativeQrScanner(
            MainActivity activity,
            FrameLayout host,
            Consumer<List<String>> resultListener,
            Runnable closeListener
    ) {
        this.activity = activity;
        this.host = host;
        this.resultListener = resultListener;
        this.closeListener = closeListener;

        overlay = new FrameLayout(activity);
        overlay.setBackgroundColor(Color.BLACK);
        previewView = new PreviewView(activity);
        previewView.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        overlay.addView(previewView, matchParent());

        View scanFrame = new View(activity);
        GradientDrawable frameDrawable = new GradientDrawable();
        frameDrawable.setColor(Color.TRANSPARENT);
        frameDrawable.setStroke(dp(3), Color.WHITE);
        frameDrawable.setCornerRadius(dp(12));
        scanFrame.setBackground(frameDrawable);
        FrameLayout.LayoutParams frameParams = new FrameLayout.LayoutParams(dp(280), dp(280), Gravity.CENTER);
        overlay.addView(scanFrame, frameParams);

        TextView title = makeText("Aponte para o QR Code", 18, true);
        FrameLayout.LayoutParams titleParams = wrapContent(Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        titleParams.topMargin = dp(22);
        overlay.addView(title, titleParams);

        TextView closeButton = makeText("\u2715", 28, true);
        closeButton.setGravity(Gravity.CENTER);
        closeButton.setBackground(buttonBackground());
        closeButton.setContentDescription("Fechar camera");
        closeButton.setOnClickListener(v -> closeFromUser());
        FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP | Gravity.END);
        closeParams.topMargin = dp(10);
        closeParams.rightMargin = dp(10);
        overlay.addView(closeButton, closeParams);

        torchButton = makeText("\uD83D\uDD26", 23, true);
        torchButton.setGravity(Gravity.CENTER);
        torchButton.setBackground(buttonBackground());
        torchButton.setAlpha(0.28f);
        torchButton.setContentDescription("Ligar lanterna");
        torchButton.setOnClickListener(v -> toggleTorch());
        FrameLayout.LayoutParams torchParams = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP | Gravity.START);
        torchParams.topMargin = dp(10);
        torchParams.leftMargin = dp(10);
        overlay.addView(torchButton, torchParams);

        statusView = makeText("Leitura continua ativa", 15, true);
        statusView.setGravity(Gravity.CENTER);
        statusView.setPadding(dp(16), dp(10), dp(16), dp(10));
        statusView.setBackground(buttonBackground());
        FrameLayout.LayoutParams statusParams = wrapContent(Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        statusParams.bottomMargin = dp(22);
        overlay.addView(statusView, statusParams);

        ZoomSuggestionOptions zoomOptions = new ZoomSuggestionOptions.Builder(zoomRatio -> {
            Camera activeCamera = camera;
            if (activeCamera == null || paused || closed) {
                return false;
            }
            activeCamera.getCameraControl().setZoomRatio(zoomRatio);
            return true;
        }).build();
        BarcodeScannerOptions options = new BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .enableAllPotentialBarcodes()
                .setZoomSuggestionOptions(zoomOptions)
                .build();
        barcodeScanner = BarcodeScanning.getClient(options);

        configureGestures();
    }

    void open() {
        host.addView(overlay, matchParent());
        startCamera();
    }

    void resumeScanning() {
        if (closed) {
            return;
        }
        paused = false;
        processing.set(false);
        collectionGeneration++;
        collectionScheduled = false;
        pendingValues.clear();
        overlay.setVisibility(View.VISIBLE);
        statusView.setText("Leitura continua ativa");
    }

    void close() {
        if (closed) {
            return;
        }
        closed = true;
        paused = true;
        processing.set(true);
        collectionGeneration++;
        collectionScheduled = false;
        pendingValues.clear();
        if (cameraProvider != null) {
            if (camera != null && camera.getCameraInfo().hasFlashUnit()) {
                camera.getCameraControl().enableTorch(false);
            }
            cameraProvider.unbindAll();
        }
        barcodeScanner.close();
        analyzerExecutor.shutdown();
        host.removeView(overlay);
    }

    private void closeFromUser() {
        close();
        closeListener.run();
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(activity);
        future.addListener(() -> {
            if (closed) {
                return;
            }
            try {
                cameraProvider = future.get();
                Preview preview = new Preview.Builder().build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());

                ImageAnalysis analysis = new ImageAnalysis.Builder()
                        .setTargetResolution(new Size(1280, 720))
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build();
                analysis.setAnalyzer(analyzerExecutor, this::analyze);

                cameraProvider.unbindAll();
                camera = cameraProvider.bindToLifecycle(
                        activity,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis
                );
                boolean hasFlash = camera.getCameraInfo().hasFlashUnit();
                torchButton.setVisibility(hasFlash ? View.VISIBLE : View.INVISIBLE);
                updateTorchButton(false);
            } catch (Exception e) {
                statusView.setText("Nao foi possivel abrir a camera");
            }
        }, ContextCompat.getMainExecutor(activity));
    }

    @androidx.camera.core.ExperimentalGetImage
    private void analyze(ImageProxy imageProxy) {
        if (closed || paused || !processing.compareAndSet(false, true)) {
            imageProxy.close();
            return;
        }
        Image mediaImage = imageProxy.getImage();
        if (mediaImage == null) {
            processing.set(false);
            imageProxy.close();
            return;
        }

        InputImage image = InputImage.fromMediaImage(
                mediaImage,
                imageProxy.getImageInfo().getRotationDegrees()
        );
        barcodeScanner.process(image)
                .addOnSuccessListener(this::handleBarcodes)
                .addOnCompleteListener(task -> {
                    imageProxy.close();
                    if (!paused) {
                        processing.set(false);
                    }
                });
    }

    private void handleBarcodes(List<Barcode> barcodes) {
        if (paused || closed) {
            return;
        }
        boolean encontrouQr = false;
        for (Barcode barcode : barcodes) {
            String value = barcode.getRawValue();
            if (value == null || value.trim().isEmpty()) {
                continue;
            }
            pendingValues.add(value.trim());
            encontrouQr = true;
            Rect box = barcode.getBoundingBox();
            if (box != null && box.width() < dp(80) && camera != null) {
                float current = camera.getCameraInfo().getZoomState().getValue() == null
                        ? 1f
                        : camera.getCameraInfo().getZoomState().getValue().getZoomRatio();
                camera.getCameraControl().setZoomRatio(Math.min(current * 1.25f, maxZoom()));
            }
        }
        if (encontrouQr && !collectionScheduled) {
            collectionScheduled = true;
            int generation = ++collectionGeneration;
            statusView.setText("Identificando etiquetas...");
            overlay.postDelayed(() -> deliverPendingValues(generation), QR_COLLECTION_WINDOW_MS);
        }
    }

    private void deliverPendingValues(int generation) {
        if (closed || paused || generation != collectionGeneration) {
            return;
        }
        List<String> values = new ArrayList<>(pendingValues);
        pendingValues.clear();
        collectionScheduled = false;
        if (values.isEmpty()) {
            statusView.setText("Leitura continua ativa");
            return;
        }
        paused = true;
        processing.set(true);
        statusView.setText(values.size() > 1
                ? "Escolha a etiqueta no aplicativo."
                : "QR lido. Confirme no aplicativo.");
        // A CameraX continua vinculada e pronta; ocultamos somente a camada nativa
        // para a confirmacao aparecer sobre a WebView sem fechar/reabrir a camera.
        overlay.setVisibility(View.INVISIBLE);
        resultListener.accept(values);
    }

    @SuppressLint("ClickableViewAccessibility")
    private void configureGestures() {
        ScaleGestureDetector detector = new ScaleGestureDetector(
                activity,
                new ScaleGestureDetector.SimpleOnScaleGestureListener() {
                    @Override
                    public boolean onScaleBegin(ScaleGestureDetector detector) {
                        pinchStartZoom = currentZoom();
                        return true;
                    }

                    @Override
                    public boolean onScale(ScaleGestureDetector detector) {
                        if (camera == null) {
                            return false;
                        }
                        float ratio = pinchStartZoom * detector.getScaleFactor();
                        camera.getCameraControl().setZoomRatio(Math.max(1f, Math.min(ratio, maxZoom())));
                        return true;
                    }
                }
        );
        previewView.setOnTouchListener((view, event) -> {
            detector.onTouchEvent(event);
            if (event.getAction() == MotionEvent.ACTION_UP && !detector.isInProgress() && camera != null) {
                MeteringPoint point = previewView.getMeteringPointFactory().createPoint(event.getX(), event.getY());
                FocusMeteringAction action = new FocusMeteringAction.Builder(
                        point,
                        FocusMeteringAction.FLAG_AF | FocusMeteringAction.FLAG_AE
                ).setAutoCancelDuration(3, TimeUnit.SECONDS).build();
                camera.getCameraControl().startFocusAndMetering(action);
            }
            return true;
        });
    }

    private void toggleTorch() {
        if (camera == null || !camera.getCameraInfo().hasFlashUnit()) {
            return;
        }
        boolean next = !torchEnabled;
        camera.getCameraControl().enableTorch(next);
        updateTorchButton(next);
    }

    private void updateTorchButton(boolean enabled) {
        torchEnabled = enabled;
        torchButton.setAlpha(enabled ? 1f : 0.28f);
        torchButton.setContentDescription(enabled ? "Desligar lanterna" : "Ligar lanterna");
        torchButton.setSelected(enabled);
    }

    private float currentZoom() {
        if (camera == null || camera.getCameraInfo().getZoomState().getValue() == null) {
            return 1f;
        }
        return camera.getCameraInfo().getZoomState().getValue().getZoomRatio();
    }

    private float maxZoom() {
        if (camera == null || camera.getCameraInfo().getZoomState().getValue() == null) {
            return 8f;
        }
        return camera.getCameraInfo().getZoomState().getValue().getMaxZoomRatio();
    }

    private TextView makeText(String text, int sp, boolean bold) {
        TextView view = new TextView(activity);
        view.setText(text);
        view.setTextColor(Color.WHITE);
        view.setTextSize(sp);
        if (bold) {
            view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
        }
        return view;
    }

    private GradientDrawable buttonBackground() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(0xAA111111);
        drawable.setCornerRadius(dp(8));
        drawable.setStroke(dp(1), 0x88FFFFFF);
        return drawable;
    }

    private FrameLayout.LayoutParams matchParent() {
        return new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        );
    }

    private FrameLayout.LayoutParams wrapContent(int gravity) {
        return new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                gravity
        );
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
}
