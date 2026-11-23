# Build 09 · Streaming local replies

These Chromium captures use a paced fictional reply so each state is visible. The demo uses live Qwen3; a short reply may finish almost at once.

| Waiting | Text arriving | Complete |
| --- | --- | --- |
| [How the wait looks](waiting-light.jpg) | [A partial reply beside the selection](arriving-light.jpg) | [The finished reply in the same card](complete-light.jpg) |

[Graphite on a narrow screen](mobile-dark.jpg) · [Build 08: compact Study help](../build-08/README.md)

## Try it

Open [the local demo](http://127.0.0.1:8769/#course/DEMO). Choose **Change the slope**, select **stays fixed**, and choose **Explain → Explain locally**. Leave the question blank or ask what “fixed” means.

To start this demo yourself, run `sh start-grader.sh` in a separate terminal if the grader isn’t already running. Then run:

```sh
python3 -B hub.py serve --demo --port 8769 --grader-port 8766
```

Also try **Generate definition**, **Translate**, or **Ask further** in Study help. For written feedback, submit an answer in **Compare two lines**. For a practice test, submit first, then choose **Mark with local model** on an eligible answer.

## What changed

- Inspired by [Stream UI’s waiting, streaming, and complete states](https://streamui.dev/docs/primitives), keskity displays real local model output as it arrives. Small batches fade in over 120 ms. Nothing holds up the finished reply. No React or new dependency.
- The tab row stays in place. Reduced motion shows only the completed reply, and screen readers get status updates rather than token-by-token announcements.
- Partial text is temporary. A failed or interrupted reply clears the preview. Verdicts, points, and saved feedback update only after validation; an incomplete reply doesn’t record help. Reviewed notes and answer-key checks still appear immediately, without streaming.
- The model still runs only when requested, and only on the host computer. There is no new cloud service, inference during active tests, or change to what gets exported.

[Model stream and privacy contract](../../MODEL.md#streaming)
