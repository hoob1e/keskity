# Build 01 · Workspace and Dashboard

These are screenshots of the running app with fictional data, not mockups.

- [Dashboard · White Violet](dashboard-light.jpg)
- [Dashboard · Graphite](dashboard-dark.jpg)
- [Dashboard · narrow viewport](dashboard-mobile.jpg)

Run `python3 -B hub.py serve --demo --port 8767` and open <http://127.0.0.1:8767> to try it without touching your study records.

## What to try

- Open and leave a problem. **Resume set** should return to that problem. The library groups course packs and shows packs without a course under **Independent study**.
- Switch between Dashboard, Data, and Study. Data shows saved submissions and attempted problems; it does not estimate study time.
- Hover over links and press a button. Notice the highlight and the slight press feedback. Keyboard focus stays visible without moving the control.
- Use the previous, pause, and next controls on **Study tip**. Only the tip text moves during auto-rotation. The card pauses rotation while hovered or focused. The system’s reduced-motion setting turns off automatic rotation and press movement.

Continue to [build 02](../build-02/README.md) for Study and the problem cards.
