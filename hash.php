<?php

$password = "ictlaoPassw0rd1tnem";

$hash = password_hash($password, PASSWORD_DEFAULT);

echo $hash;
