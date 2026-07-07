当前这个自写固定冗余方案的具体设计会影响效率。
主要影响有三块：
固定 K=16, R=8，冗余太硬
每个 generation 永远发 16 个原始包 + 8 个 repair 包。也就是不管链路好不好，先天多发 50% 包。有效信息率最多约 16/24 = 66.7%。
标准 rateless fountain/RaptorQ 的好处是可以按需生成 repair，接收端理论上拿到略多于原始自由度就能恢复，冗余可以更接近实际丢包率。

不是 rateless，尾部等待效率差
当前每代只有 8 个 repair。接收端如果某些 generation 差一两个 rank，它只能等循环里再次出现相关包。后期经常扫到大量已收过的 packet，于是 dupes 会涨。
真正 fountain 类协议更像“继续吐新的有用组合包”，尾部更顺滑。

小文件极其低效
小到几个字符也最少走 1 个 generation，也就是 24 张 QR。这里和“不标准”相关，但更准确说是协议没有 small-payload path。
一个标准/成熟设计通常会有 base block、manifest、short payload 模式，不会这么浪费。

---

s / xl 更准确地说应该是 QR size/version profile，不是 ECC level。比如：
S: V10
M: V20
L: V30
XL: V40
然后每个 size 下面再选 ECC：L/M/Q/H。这个命名会比现在 V20-M 这种工程参数舒服很多。


---

第一条说的是：发送端固定冗余太高。
每个 generation 固定发 16 原始 + 8 repair = 24，即使链路很好也强制多发 50%。这是“前期/整体冗余浪费”。
第二条说的是：虽然冗余高，但 repair 的种类又太少，且不是无限新 repair。
每个 generation 只有 8 个固定 repair。接收端如果因为丢帧/漏扫，某个 generation 还差 rank，它不能拿到“新的第 9、第 10、第 11 个 repair 组合”，只能等下一轮循环，重新碰那 24 个固定包。于是尾部会有很多重复包。
所以它是一个很尴尬的组合：
整体看：固定 8 个 repair 太浪费，因为很多时候用不上。
尾部看：固定 8 个 repair 又不够灵活，因为缺的时候不能继续生成新的 repair。

---

RaptorQ WASM build 的 bulk-memory / wasm-opt 问题：

Colab 里 `wasm-pack build --release --target web` 已经能完成 Rust 编译，但 wasm-pack 后处理阶段调用内置 `wasm-opt` 时会失败：

`Bulk memory operations require bulk memory [--enable-bulk-memory]`

原因是 Rust/wasm-bindgen 生成的 wasm 里包含 `memory.copy` / `memory.fill` 这类 bulk-memory 指令，但当前 wasm-pack 下载的 Binaryen/wasm-opt validator 没有用 bulk-memory feature 运行。这个问题发生在优化/校验阶段，不是 RaptorQ Rust 代码编译失败。

当前临时处理是在生成 wrapper crate 的 `Cargo.toml` 里加入：

```toml
[package.metadata.wasm-pack.profile.release]
wasm-opt = false
```

影响：
正确性基本不受影响，wasm-bindgen glue 和 wasm 仍然可用。
包体可能偏大，启动/执行可能少一点优化收益。
现代浏览器一般支持 bulk-memory，实际兼容性风险主要在非常旧的浏览器。

后续可优化：
尝试安装新版 Binaryen，并让 wasm-opt 以支持 bulk-memory 的参数运行。
或者确认是否能通过 Rust 编译参数生成不依赖 bulk-memory 的 wasm，但这可能牺牲性能/体积。
拿到真实 artifact 后固定跑 `pnpm verify:raptorq-wasm`，确认 init / encode / decode roundtrip 都正常。
