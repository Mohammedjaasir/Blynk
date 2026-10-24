/*
 * Copyright 2020 Google Inc. (Bubblewrap template, Apache License 2.0)
 */
package lk.blynk.customer;

/** Lets Chrome show the shop's web push notifications as Blynk app notifications. */
public class DelegationService extends
        com.google.androidbrowserhelper.trusted.DelegationService {
    @Override
    public void onCreate() {
        super.onCreate();
    }
}
