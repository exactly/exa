import domain from "@exactly/common/domain";

export default {
  "web.exactly.app": [
    "38:12:6D:6C:E8:0C:E0:75:D9:EF:F5:3B:16:A9:F2:E7:CA:9E:11:1D:54:70:30:CA:99:C6:08:83:D2:A7:E8:85", // google
    "9C:4C:A3:27:B8:F1:97:92:8A:A0:02:D6:82:EC:9E:10:EE:8F:D6:03:A1:A6:91:C0:C6:71:77:70:1E:F5:AC:11", // expo
  ],
  "sandbox.exactly.app": [
    "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C", // production
    "9C:4C:A3:27:B8:F1:97:92:8A:A0:02:D6:82:EC:9E:10:EE:8F:D6:03:A1:A6:91:C0:C6:71:77:70:1E:F5:AC:11", // expo
  ],
}[domain] ?? ["FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C"];
