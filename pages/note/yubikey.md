## YubiKeyに秘密鍵管理を一元化してみた
- 参考URL
 - https://developers.yubico.com/yubico-piv-tool/SSH_with_PIV_and_PKCS11.html
 - http://qiita.com/jkr_2255/items/6927758094c3078e62c5
 - https://developers.yubico.com/PIV/Introduction/Certificate_slots.html
 - http://www.cuspy.org/diary/2015-08-11-yubikey-piv-ssh/

## 手順
### Mac OSX
* Yubikey PIV Managerをインストール
* Certificates -> Authentication -> Generate new key ...
* brewでopenscをインストール
* 公開鍵を取り出す
```
ssh-keygen -D /usr/local/opt/opensc/lib/opensc-pkcs11.so  > yubikey_auth.pub
```
* キーをssh agentに登録
```
ssh-add -s /usr/local/opt/opensc/lib/opensc-pkcs11.so
```
 * ここでキーのPINを入力
* 取り出した公開鍵をサーバーに登録
* クライアント側の`~/.ssh/config`に下記を追加
```
Host <hostname>
	HostName		<hostname>
	User			<username>
	PKCS11Provider	/usr/local/opt/opensc/lib/opensc-pkcs11.so 
```
これでYubiKeyを秘密鍵としてsshログインできるようになる．

- http://no-passwd.net/fst-01-gnuk-handbook/gnuk-intro.html

### Ubuntu on VMware
- https://mikebeach.org/2013/08/15/personalizing-your-yubikey-in-a-windows-vmware-virtual-machine/
.vmxファイルに下記を追加
```
usb.generic.allowHID = "TRUE"
```
- Yubico.com Yubikey 4 OTP+U2F+CCIDに接続
 - 一度抜き差しする
 - すると認識される
```
opensc-tool -l
```
- `gpg-connect-agent`で`ERR 67108983 スマートカードデーモンがありません`となる場合
 - http://unix.stackexchange.com/questions/253462/why-do-gnupg-2-and-gpg-connect-agent-fail-with-err-67108983-no-smartcard-daemon
 - scdaemonが足りないので入れる
```
sudo apt-get install scdaemon
```

### PINリセットの話
- https://developers.yubico.com/ykneo-openpgp/PinRetries.html
- PINの残り試行回数を示す3つの数字は，左から
```
UserPIN ResetCode AdminPIN
```
の残り試行回数を表している．

### Mac OSXで`opensc-tool --list-readers`が`No smart card readers found.`と言ってくる話
- http://forum.yubico.com/viewtopic.php?f=26&t=1689
- 理由は分からないが，Connection ModeがすべてONになっているとうまくいかないようだ．
- 私の場合，Yubikey Neo Managerで，ConnectionModeからOTPのチェックを外したところ，正常に認識されるようになった．

### メモ
- `gpg2 -k`で鍵リスト表示

