import handlebars from "handlebars";
import helpers from "handlebars-helpers";
import { readFileSync, writeFileSync } from "node:fs";

helpers({ handlebars });

writeFileSync("substreams.yaml", handlebars.compile(readFileSync("substreams.yaml.hbs", "utf8"))(process.env));
