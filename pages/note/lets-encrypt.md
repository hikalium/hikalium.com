Let's encrypt をCentOS7に導入してみた
====

無料でSSL証明書を取得できるLet's Encryptのベータテストが始まったので、試してみました。

* ベータテスト申請フォーム
https://docs.google.com/forms/d/15Ucm4A20y2rf9gySCTXD6yoLG6Tba7AwYgglV7CKHmM/viewform?c=0&w=1

運良くベータテスターに選ばれると、Let's Encryptからメールがきます。
そのメール中に書かれているコマンドとLet's Encrypt公式ヘルプページを参考にすれば迷わないとは思いますが、一応手順をメモしておきます。

* Let's Encrypt 公式のヘルプページ
 * https://letsencrypt.readthedocs.org/en/latest/using.html#letsencrypt-auto

## 作業手順

<pre class="brush: bash">
# 安全な場所に移動する。
cd /root

# クライアントをgit経由でダウンロードする。 
git clone https://github.com/letsencrypt/letsencrypt
cd letsencrypt/

# 一度実行する。
./letsencrypt-auto

# この環境では自動で証明書の設定ができない、と言われるので、手動で証明書をダウンロードする。
# 証明書のダウンロードに使うポートがWebサーバーのポートとかぶっているため、一度Webサーバーを停止する。
systemctl stop httpd

# ダウンロードする
./letsencrypt-auto certonly -a standalone -d www.example.com --server https://acme-v01.api.letsencrypt.org/directory --agree-dev-preview

# 証明書は以下のパスに保存される。
# /etc/letsencrypt/live/www.example.com/

# Webサーバーを再開する
systemctl start httpd
</pre>

以上の手順で証明書がサーバー内にダウンロードされますが、まだWebサーバーの設定を行っていないため、httpsで接続することはできません。ということで、Webサーバーのほうをを設定していきます。
<pre class="brush: bash">
# mod_sslが必要になるのでyum経由で入れる。
yum install mod_ssl

# 設定ファイルを編集する
vi /etc/httpd/conf.d/ssl.conf

</pre>

設定ファイルの内容のうち、以下の項目を設定します。
* 参考文献
 * https://letsencrypt.readthedocs.org/en/latest/using.html#where-are-my-certificates

<pre>
SSLCertificateFile /etc/letsencrypt/live/www.example.com/cert.pem
SSLCertificateKeyFile /etc/letsencrypt/live/www.example.com/privkey.pem
SSLCertificateChainFile /etc/letsencrypt/live/www.example.com/chain.pem
</pre>

設定が完了したら、Webサーバーを再起動します。
<pre class="brush: bash">
systemctl restart httpd
</pre>

# firewalldの設定
firewalldを起動している場合は、httpsを許可する設定を追加します。
<pre class="brush: bash">
firewall-cmd --list-service --zone public
firewall-cmd --add-service=https --zone public --permanent
firewall-cmd --reload
</pre>

さらに、VPSを利用している場合、VPS側の設定で443/TCPのポートを弾いていないか確認してください。

設定ファイルを適切に設定したのち、Webサーバーを再起動すれば、HTTPSでアクセスできます！

https://hikalium.com

しかし、VirtualHostを設定している場合は、証明書の対象でないドメインでhttpsでのアクセスを試みた場合に、ブラウザにとても怒られます。そんな場合は、VirtualHostディレクティブの中にSSLの設定を移してください。

以下のサイトを参考にするとよいでしょう。
* https://blog.apar.jp/linux/378/
* http://qiita.com/takayukioda/items/70572e1da228795e0d4b

## 証明書の更新手順(2016-02-11追記)
ベータテストも終わり一般利用が始まったので、ACMEクライアントもyumから入れられるようになりました。(epelリポジトリより。)
<pre class="brush: bash">
yum install letsencrypt 
</pre>
更新手順は以下の公式ページマニュアルの通り、証明書取得と全く同じコマンドを入力すればOKです。（httpdの停止をお忘れなく。）
* https://letsencrypt.readthedocs.org/en/latest/using.html#renewal

<pre class="brush: bash">
letsencrypt certonly -a standalone -d www.example.com
</pre>

## 参考文献
* [Let's Encrypt 公式ページ](https://letsencrypt.org/) 
* [公式マニュアル](https://letsencrypt.readthedocs.org/en/latest/index.html)

