## [Raphine/Raph_Kernel](https://github.com/Raphine/Raph_Kernel)のメモ
- [ソースコード解説](https://raphine.wordpress.com/kernel/code_reading/)

- ACPI関連は[ACPICA](https://acpica.org/)がほとんど全部やってくれるらしい。さすがIntel.

### CpuCtrlクラスによる動的CPU割り付けインターフェースの作成
- cpuctl: `rlib/cpu.h`
- https://github.com/Raphine/Raph_Library/blob/master/rlib/cpu.h
- https://github.com/Raphine/Raph_Kernel/blob/master/source/kernel/main.cc#L442

### CPUのコア割りあてに関する戦略
- 最低でも2コアあることを前提とする
 - Primary core
 - それ以外のコア

### apic id と cpuid の変換
`source/kernel/apic.h` の`ApicCtrl::Lapic::GetApicIdFromCpuId(int cpuid)`

`_apicIds[]`という配列を参照している。この配列での添え字番号が`cpuid`,そこにある値が`apicid`となっている。 

"apic.cc" 197 行で`_apicIds[]`は初期化されている。

この元データは、[MADT](http://wiki.osdev.org/MADT)(Multiple APIC Description Table)に存在する。

`madtStLAPIC`構造体がそのエントリである。

エントリの出現順に、0からcpuidを付与する。（これはOS側でそう決めている）

- http://shimada-k.hateblo.jp/entry/20110601/1306952989
- Intel ASDM Volume 3 `8.9 PROGRAMMING CONSIDERATIONS FOR HARDWARE MULTI-THREADING CAPABLE PROCESSORS`

`madtStLAPIC`に書かれている`Initial APIC ID (Processor ID)`は、最小単位がスレッドなので、必ずしもコア単位で連続しない。そのため、OS側でCPU番号を再度振っている。

From: ACPI Spec. 6.1 `5.2.12.1 MADT Processor Local APIC / SAPIC Structure Entry Order`

```
To ensure that the boot processor is supported post initialization, two guidelines should be followed. The first is that OSPM should initialize processors in the order that they appear in the MADT. The second is that platform firmware should list the boot processor as the first processor entry in the MADT.
```

上記より、cpuid==0となるプロセッサコアは、ブートプロセッサである。



### 計画
- 「どういった目的でCPUがほしいか」
 - kCPUForHighPerformance(基本的に単一コアを割りあて)
 - kCPUForLowPriority(ある特定の1コアに集約)
 - kCPUForGeneralPurpose（余ったものを適当に割りあて）

### 現在の状況
- master cpu (), main()が走っている
- それ以外のコア, main_of_others()が走っている
 - apic id 0

cpuid int -> tekitou struct 
taskに対してcpuid TODO: cpuid

