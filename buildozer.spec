[app]
title = SHAHEEN 100 ARMY
package.name = shaheenarmy
package.domain = com.ustadjee.shaheen
source.dir = .
version = 34
requirements = python3==3.10.12, hostpython3==3.10.12, kivy==2.3.0, requests, urllib3, charset-normalizer, certifi, idna
orientation = portrait
fullscreen = 0
android.permissions = INTERNET,ACCESS_NETWORK_STATE
[buildozer]
log_level = 2
[app:android]
android.api = 33
android.minapi = 21
android.sdk = 33
android.accept_sdk_license_agreements = True
android.archs = arm64-v8a
