#!/usr/bin/env python3
"""`npx cap add android` sonrası üretilen projeyi Lumen için yamalar:
sürüm kodu/adı, kurulum izni, uygulama adı."""
import re, sys, pathlib

version_code, version_name = sys.argv[1], sys.argv[2]
root = pathlib.Path("android")

gradle = root / "app/build.gradle"
g = gradle.read_text()
g = re.sub(r"versionCode\s+\d+", f"versionCode {version_code}", g)
g = re.sub(r'versionName\s+"[^"]*"', f'versionName "{version_name}"', g)
gradle.write_text(g)

man = root / "app/src/main/AndroidManifest.xml"
m = man.read_text()
for perm in ('<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />',
             '<uses-permission android:name="android.permission.VIBRATE" />'):  # tesbih titreşimi
    if perm not in m:
        m = m.replace("</manifest>", f"    {perm}\n</manifest>")
man.write_text(m)

strings = root / "app/src/main/res/values/strings.xml"
s = strings.read_text()
s = re.sub(r"(<string name=\"app_name\">)[^<]*(</string>)", r"\1Lumen\2", s)
s = re.sub(r"(<string name=\"title_activity_main\">)[^<]*(</string>)", r"\1Lumen\2", s)
strings.write_text(s)
print("android yamalandı:", version_code, version_name)
