## Local Setup

```
sudo apt install ruby bundler
sudo gem update bundler
sudo chown -R $USER:$USER /var/lib/gems /usr/local/bin/
bundle install
```

## Serve locally

```
jekyll serve
```

## Take a snapshot locally

```
# A dir `snapshot` will be created, and the progress will be saved to `snapshot.log`
wget -r --tries=10 https://hikalium.com -P snapshot | tee snapshot.log
```
