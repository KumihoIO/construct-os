# Android Setup

Construct provides prebuilt binaries for Android devices.

## Supported Architectures

| Target | Android Version | Devices |
|--------|-----------------|---------|
| `armv7-linux-androideabi` | Android 4.1+ (API 16+) | Older 32-bit phones (Galaxy S3, etc.) |
| `aarch64-linux-android` | Android 5.0+ (API 21+) | Modern 64-bit phones |

## Installation via Termux

The easiest way to run Construct on Android is via [Termux](https://termux.dev/).

<!-- TODO screenshot: Termux app listing on F-Droid ready to install -->
![Termux app listing on F-Droid ready to install](../assets/hardware/android-setup-01-termux-fdroid.png)

### 1. Install Termux

Download from [F-Droid](https://f-droid.org/packages/com.termux/) (recommended) or GitHub releases.

> ⚠️ **Note:** The Play Store version is outdated and unsupported.

### 2. Download Construct

```bash
# Check your architecture
uname -m
# aarch64 = 64-bit, armv7l/armv8l = 32-bit

# Download the appropriate binary
# For 64-bit (aarch64):
curl -LO https://github.com/KumihoIO/construct-os/releases/latest/download/construct-aarch64-linux-android.tar.gz
tar xzf construct-aarch64-linux-android.tar.gz

# For 32-bit (armv7):
curl -LO https://github.com/KumihoIO/construct-os/releases/latest/download/construct-armv7-linux-androideabi.tar.gz
tar xzf construct-armv7-linux-androideabi.tar.gz
```

<!-- TODO screenshot: Termux terminal on Android showing successful `construct --version` output -->
![Termux terminal on Android showing successful construct --version output](../assets/hardware/android-setup-02-termux-construct-version.png)

### 3. Install and Run

```bash
chmod +x construct
mv construct $PREFIX/bin/

# Verify installation
construct --version

# Run setup
construct onboard
```

## Direct Installation via ADB

For advanced users who want to run Construct outside Termux:

```bash
# From your computer with ADB
adb push construct /data/local/tmp/
adb shell chmod +x /data/local/tmp/construct
adb shell /data/local/tmp/construct --version
```

> ⚠️ Running outside Termux requires a rooted device or specific permissions for full functionality.

<!-- TODO screenshot: Android storage permission prompt shown when running termux-setup-storage -->
![Android storage permission prompt shown when running termux-setup-storage](../assets/hardware/android-setup-03-termux-storage-permission.png)

## Limitations on Android

- **No systemd:** Use Termux's `termux-services` for daemon mode
- **Storage access:** Requires Termux storage permissions (`termux-setup-storage`)
- **Network:** Some features may require Android VPN permission for local binding

## Building from Source

To build for Android yourself:

```bash
# Install Android NDK
# Add targets
rustup target add armv7-linux-androideabi aarch64-linux-android

# Set NDK path
export ANDROID_NDK_HOME=/path/to/ndk
export PATH=$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin:$PATH

# Build
cargo build --release --target armv7-linux-androideabi
cargo build --release --target aarch64-linux-android
```

## Troubleshooting

### "Permission denied"
```bash
chmod +x construct
```

### "not found" or linker errors
Make sure you downloaded the correct architecture for your device.

### Old Android (4.x)
Use the `armv7-linux-androideabi` build with API level 16+.
