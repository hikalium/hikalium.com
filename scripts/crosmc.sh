#!/bin/bash -xe
TMPDIR=`mktemp -d`
sudo apt --fix-broken install
sudo apt-get update && sudo apt-get install -y default-jdk
wget -O ${TMPDIR}/Minecraft.deb https://launcher.mojang.com/download/Minecraft.deb
sudo apt-get update --allow-releaseinfo-change
sudo apt-get install libsecret-1-0 -y
sudo dpkg -i ${TMPDIR}/Minecraft.deb
# Now, you should be able to see Minecraft Launcher from the app launcher

