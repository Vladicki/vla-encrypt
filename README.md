# vla-encrypt

Simple Wails desktop app with Go backend and React frontend.

## What you need

### All platforms
- Go
- Node.js + npm
- Wails CLI

Install Wails CLI:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
wails doctor
```

## Platform requirements

### Linux
Required system packages:
- gcc build tools
- GTK3 dev package
- WebKitGTK dev package

If your distro uses WebKit 4.1 instead of 4.0, build with the `webkit2_41` tag.

### macOS
Install Xcode Command Line Tools:

```bash
xcode-select --install
```

### Windows
Required:
- WebView2 Runtime
- C/C++ build tools

Run `wails doctor` to confirm setup.

## Install project dependencies

From project root:

```bash
cd frontend
npm install
cd ..
```

## Run app in development

```bash
wails dev
```

## Build app

### Default build

```bash
wails build

# Linux with WebKit 4.1

wails build -tags webkit2_41

```

### For MacOS or Windows 

```
# Windows script 
./scripts/build-windows.sh

# Macos script 
./scripts/build-macos.sh

```
## Output

Built app location will be:

```text

./build/bin/vla-encrypt

```

## Testing

Run backend tests from project root:

```bash
go test ./...
```

Current automated testing focuses on the Go backend logic that drives encryption, decryption, file format handling, and direct file overwrite behavior. The tests cover successful payload encode/decode round trips, successful AES-GCM encrypt/decrypt round trips, valid envelope parsing, malformed envelope rejection, empty-key rejection for decryption, direct file write behavior, and a temporary-file-backed decrypt-in-place round trip that confirms original plaintext bytes are restored correctly.

Testing performed on the application includes normal and failure-oriented conditions. Normal-path checks verify that encrypted data can be decrypted back to the original content and that encoded metadata survives round trips intact. Failure-path checks verify that malformed encrypted input is rejected and that decryption without a key fails immediately. These tests are intentionally deterministic and do not depend on live external entropy APIs, so they stay simple and reliable while validating the program’s critical backend behavior.

## Included helper scripts

Optional scripts in `scripts/`:
- `install-wails-cli.sh`
- `build.sh`
- `build-windows.sh`
- `build-macos.sh`
- `build-macos-arm.sh`
- `build-macos-intel.sh`
