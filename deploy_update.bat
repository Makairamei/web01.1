@echo off
echo ==========================================
echo  AUTO DEPLOY UPDATES TO VPS (CS Premium)
echo ==========================================
echo.
echo Uploading server.js, database.js and public assets...
scp server.js database.js root@159.223.82.116:~/web/
scp -r public/* root@159.223.82.116:~/web/public/
echo.
echo Restarting Server...
ssh root@159.223.82.116 "cd ~/web && npm install && pm2 restart admin-panel"
echo.
echo ==========================================
echo  DEPLOY SUCCESS!
echo  Please check if Admin Panel is accessible.
echo ==========================================
pause
