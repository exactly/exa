if (!process.env.PAX_ASSOCIATE_ID_SECRET) throw new Error("missing pax associate id secret");

export default process.env.PAX_ASSOCIATE_ID_SECRET as string; // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion
