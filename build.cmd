@echo off
REM Lanceur Windows. Toute la logique est dans build.mjs, partagee avec
REM build.sh : il n'y a qu'une seule implementation a maintenir.
node "%~dp0build.mjs" %*
