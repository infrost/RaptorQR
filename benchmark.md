# Benchmark Reference

These numbers are reference measurements for the real WASM QR transfer path.
They are not portable guarantees: CPU, Node/V8 version, OS scheduling, and
test-runner load can move the results. Use them as a baseline for spotting
large regressions before publishing.

## Commands

```bash
pnpm build
pnpm benchmark
pnpm benchmark:final
```

`pnpm benchmark` is the lightweight edit-loop check. `pnpm benchmark:final`
is the release gate for the high-throughput scenario below.

## Final V30 4-Way Transfer

The final benchmark is implemented in `benchmark.final.test.ts` and exercises
the end-to-end transfer stack:

- RaptorQ packetization through `@raptorqr/raptorq-wasm`
- default Balanced loop ordering with repair packets evenly interleaved
- QR rendering through `@raptorqr/fast-qr-wasm`
- 4 QR symbols per display frame in a 2x2 composite image
- QR parsing through `decodeQRCodesFromCanvas`
- packet parsing and RaptorQ decode back to the original payload

Scenario:

| Setting | Value |
| --- | ---: |
| QR profile | V30-L |
| QR renderer | fast QR WASM |
| Display rate | 30 fps |
| Duration | 10 seconds |
| Display frames | 300 |
| Parallel QR symbols | 4 per display frame |
| Total QR symbol slots | 1200 |
| RaptorQ repair | 20% |
| Dropped QR symbols | 200 |
| Source QR symbols received | 1000 |
| Payload bytes | 1,716,000 |
| QR tile size | 290 px |
| Composite frame size | 580 x 580 px |

The loss model drops 200 QR symbols, not 200 display frames. Dropping 200
display frames in a 4-way layout could remove up to 800 QR symbols, which is a
different and much harsher scenario than the 20% repair budget is intended to
cover.

## Reference Result

Reference run:

- Date: 2026-07-09
- OS: Microsoft Windows NT 10.0.26200.0
- Logical processors: 20
- Processor identifier: Intel64 Family 6 Model 186 Stepping 2, GenuineIntel
- Node.js: v22.19.0
- pnpm: 10.15.1

Observed result from `pnpm benchmark:final`:

| Metric | Value |
| --- | ---: |
| Packetize time | 73.62 ms |
| QR render time | 4078.21 ms |
| QR decode time | 2698.88 ms |
| RaptorQ decode time | 126.00 ms |
| Total measured time | 6976.71 ms |
| Display frames consumed | 300 |
| Parsed packets | 1000 |
| Scheduled transfer speed | 167.58 KiB/s |
| Parser throughput | 593.22 KiB/s |
| Parser display rate | 106.20 fps |
| Parser QR symbol rate | 354.00 QR/s |

The most important release-readiness number here is parser display rate. This
run parsed the synthetic 30 fps stream at about 106 fps, leaving a large margin
above the target playback cadence while recovering the payload after 200 lost
QR symbols.
