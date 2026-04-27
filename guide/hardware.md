# Hardware

Serial, Bluetooth, USB, peripheral discovery

---

### PeripheralManager

**Status:** ✅ Implemented · **Category:** manager · **Since:** v1.5.0

Central device manager for all hardware peripherals. Handles connection lifecycle, reconnection logic, and device enumeration. Supports Serial, Bluetooth, and USB devices via Web APIs.

**Source files:**

- `web/clawser-hardware.js`
- `web/clawser-hardware.d.ts`

**API surface:**

- `PeripheralManager`
- `PeripheralManager.connect`
- `PeripheralManager.disconnect`
- `PeripheralManager.send`
- `PeripheralManager.read`
- `PeripheralManager.get`
- `PeripheralManager.list`
- `PeripheralManager.requestSerial`
- `PeripheralManager.requestBluetooth`
- `PeripheralManager.requestUSB`
- `PeripheralManager.reconnectSerial`
- `PeripheralManager.reconnectUSB`
- `PeripheralManager.reconnectBluetooth`
- `PeripheralManager.disconnectAll`
- `PERIPHERAL_TYPES`

> **Note:** PERIPHERAL_TYPES: SERIAL, BLUETOOTH, USB.

**See also:**

- Serial Peripherals
- Bluetooth Peripherals
- USB Peripherals

---

### PeripheralHandle

**Status:** ✅ Implemented · **Category:** base · **Since:** v1.5.0

Base class for all peripheral device handles. Provides common interface with id, type, connected status, name, and methods for connect, disconnect, send, read, and info.

**Source files:**

- `web/clawser-hardware.js`
- `web/clawser-hardware.d.ts`

**API surface:**

- `PeripheralHandle`
- `PeripheralHandle.connect`
- `PeripheralHandle.disconnect`
- `PeripheralHandle.send`
- `PeripheralHandle.read`
- `PeripheralHandle.info`

---

### Serial Peripherals

**Status:** ✅ Implemented · **Category:** serial · **Since:** v1.5.0

Web Serial API integration for connecting to serial port devices. Configurable baud rate, data bits, stop bits, and parity. Supports Arduino, microcontrollers, and other serial devices.

**Source files:**

- `web/clawser-hardware.js`
- `web/clawser-hardware.d.ts`

**API surface:**

- `SerialPeripheral`

> **Note:** Requires HTTPS. Uses Web Serial API (navigator.serial).

---

### Bluetooth Peripherals

**Status:** ✅ Implemented · **Category:** bluetooth · **Since:** v1.5.0

Web Bluetooth API integration for BLE device communication. Supports GATT service/characteristic subscription and unsubscription for real-time data streaming from BLE sensors and devices.

**Source files:**

- `web/clawser-hardware.js`
- `web/clawser-hardware.d.ts`

**API surface:**

- `BluetoothPeripheral`
- `BluetoothPeripheral.subscribe`
- `BluetoothPeripheral.unsubscribe`

> **Note:** Requires HTTPS. Uses Web Bluetooth API (navigator.bluetooth).

---

### USB Peripherals

**Status:** ✅ Implemented · **Category:** usb · **Since:** v1.5.0

WebUSB API integration for direct USB device communication. Supports bulk transfers and control transfers for USB devices.

**Source files:**

- `web/clawser-hardware.js`
- `web/clawser-hardware.d.ts`

**API surface:**

- `USBPeripheral`

> **Note:** Requires HTTPS. Uses WebUSB API (navigator.usb).

---

### Hardware Tools

**Status:** ✅ Implemented · **Category:** tools · **Since:** v1.5.0

Six agent tools for hardware interaction: hw_list, hw_connect, hw_send, hw_read, hw_disconnect, hw_info.

**Source files:**

- `web/clawser-hardware.js`
- `web/clawser-hardware.d.ts`

**API surface:**

- `HwListTool`
- `HwConnectTool`
- `HwSendTool`
- `HwReadTool`
- `HwDisconnectTool`
- `HwInfoTool`

---

### Camera Access

**Status:** 📋 Planned · **Category:** camera · **Since:** vplanned

MediaDevices API integration for capturing images and video from the device camera. Intended for visual analysis tasks and document scanning.

> **Note:** Requires HTTPS and user permission grant.

---

### Microphone Input

**Status:** 📋 Planned · **Category:** microphone · **Since:** vplanned

Web Audio API integration for voice input and speech-to-text. Would enable voice-driven agent interaction.

---

### Geolocation

**Status:** 📋 Planned · **Category:** geolocation · **Since:** vplanned

Geolocation API integration for location-aware tasks — local search, weather, timezone detection.

---

---

[← Agents](./agents.md) | [Index](./index.md) | [Networking →](./networking.md)
