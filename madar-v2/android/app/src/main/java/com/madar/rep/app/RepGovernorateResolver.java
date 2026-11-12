package com.madar.rep.app;

import android.content.Context;
import android.location.Address;
import android.location.Geocoder;
import android.os.Build;

import org.json.JSONObject;

import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Best-effort reverse geocoding of the GPS fix recorded for this exact photo. */
final class RepGovernorateResolver {
    private static final long TIMEOUT_SECONDS = 4L;
    private static final ExecutorService LEGACY_GEOCODER = Executors.newSingleThreadExecutor();

    private RepGovernorateResolver() {}

    static String resolve(Context context, JSONObject location) {
        if (location == null || !location.has("latitude") || !location.has("longitude")) return null;
        double latitude = location.optDouble("latitude", Double.NaN);
        double longitude = location.optDouble("longitude", Double.NaN);
        if (!Double.isFinite(latitude) || !Double.isFinite(longitude)
            || latitude < -90d || latitude > 90d || longitude < -180d || longitude > 180d) return null;
        if (!Geocoder.isPresent()) return null;

        try {
            Geocoder geocoder = new Geocoder(context, Locale.forLanguageTag("ar-EG"));
            List<Address> addresses;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                CountDownLatch completed = new CountDownLatch(1);
                AtomicReference<List<Address>> result = new AtomicReference<>();
                geocoder.getFromLocation(latitude, longitude, 1, new Geocoder.GeocodeListener() {
                    @Override public void onGeocode(List<Address> matches) {
                        result.set(matches);
                        completed.countDown();
                    }

                    @Override public void onError(String errorMessage) {
                        completed.countDown();
                    }
                });
                if (!completed.await(TIMEOUT_SECONDS, TimeUnit.SECONDS)) return null;
                addresses = result.get();
            } else {
                Future<List<Address>> lookup = LEGACY_GEOCODER.submit(
                    () -> geocoder.getFromLocation(latitude, longitude, 1));
                try {
                    addresses = lookup.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
                } finally {
                    if (!lookup.isDone()) lookup.cancel(true);
                }
            }
            if (addresses == null || addresses.isEmpty()) return null;
            Address address = addresses.get(0);
            String countryCode = address.getCountryCode();
            if (countryCode != null && !countryCode.trim().isEmpty() && !"EG".equalsIgnoreCase(countryCode)) return null;
            String adminArea = address.getAdminArea();
            if (adminArea == null || adminArea.trim().isEmpty()) return null;
            String name = adminArea.trim().replaceFirst("^محافظة\\s+", "").trim();
            return name.isEmpty() ? null : name;
        } catch (Exception ignored) {
            // The geocoding backend can be absent or offline; never substitute a machine's stored region.
            return null;
        }
    }
}
