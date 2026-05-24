2. [GET] http://127.0.0.1:8080/session/status?target=http%3A%2F%2F127.0.0.1%3A4096
3. [GET] http://127.0.0.1:8080/event?target=http%3A%2F%2F127.0.0.1%3A4096 => [200] OK
8. [GET] http://127.0.0.1:8080/provider => [200] OK
9. [GET] http://127.0.0.1:8080/provider/auth => [200] OK
10. [GET] http://127.0.0.1:8080/agent => [200] OK
11. [GET] http://127.0.0.1:8080/global/config => [200] OK
12. [GET] http://127.0.0.1:8080/mcp => [200] OK
13. [GET] http://127.0.0.1:8080/path => [200] OK
15. [GET] http://127.0.0.1:8080/global/config => [200] OK
16. [GET] http://127.0.0.1:8080/mcp => [200] OK

Note: 6 static requests not shown, run with "static" option to see them.