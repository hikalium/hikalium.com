## Local Setup

```
sudo gem update bundler
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
