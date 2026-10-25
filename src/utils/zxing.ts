import { prepareZXingModule } from "barcode-detector/ponyfill";
import wasm from "zxing-wasm/reader/zxing_reader.wasm";

prepareZXingModule({ overrides: { locateFile: () => wasm } });
