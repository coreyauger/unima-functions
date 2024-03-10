import { Client, Account, Databases, Query, ID, Permission, Role } from 'node-appwrite';
import { connect } from 'getstream';

function throwIfMissing(obj: any, keys: string[]): void {
  const missing: string[] = [];
  for (let key of keys) {
    if (!(key in obj) || !obj[key]) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }
}

type Context = {
  req: any;
  res: any;
  log: (msg: any) => void;
  error: (msg: any) => void;
};

// This is your Appwrite function
// It's executed each time we get a request
export default async ({ req, res, log, error }: Context) => {
  throwIfMissing(process.env, [
    'APPWRITE_API_KEY',
    'APPWRITE_FUNCTION_PROJECT_ID',
    'APPWRITE_DATABASE_ID',
    'STREAM_API_KEY',
    'STREAM_API_SECRET',
    'STREAM_APP_ID',
  ]);
    try{
       // The `req` object contains the request data
       if (req.method === 'GET') {
        // Send a response with the res object helpers
        // `res.send()` dispatches a string back to the client
        return res.error('expected POST, DELETE');
      }
      log(req.body);
      const jsonPayload = JSON.parse(req.body);
      log(jsonPayload);
      const jwtToken = jsonPayload.jwtToken;      
      if(!jwtToken)throw new Error("No JWT token in request body");
      const programId = jsonPayload.programId;
      if(!programId)throw new Error("No programId in request body");
      
      const userClient = new Client()
        .setEndpoint('https://cloud.appwrite.io/v1')
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
        .setJWT(jwtToken);

      const userAccount = new Account(userClient);

      const userId = (await userAccount.get()).$id;
      if(!userId)throw new Error("No user found from JWT token");
      log(`got userId: ${userId}`);      

      const client = new Client()
          .setEndpoint('https://cloud.appwrite.io/v1')
          .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
          .setKey(process.env.APPWRITE_API_KEY!);

      const db = new Databases(client);
      const streamClient = connect(process.env.STREAM_API_KEY!, process.env.STREAM_API_SECRET!, process.env.STREAM_APP_ID!);
      const userTimeline = await streamClient.feed("timeline", userId);
      
      if (req.method === 'POST') {
        const {documents} = await db.listDocuments(
          process.env.APPWRITE_DATABASE_ID!,
          "subscription",
          [
            Query.equal("userKey",userId)
          ]
        );
        log(`create`);
        // check if we already have a subscription to this program?
        const existing = documents.find((d: any) => d.programKey === programId);
        if(!existing){
          const subscription = await db.createDocument(
            process.env.APPWRITE_DATABASE_ID!,
            "subscription",
            ID.unique(),
            {
              "userKey": userId,
              "programKey": programId
            },
            [
              Permission.read(Role.users()),        
              Permission.update(Role.team("admin")),
              Permission.delete(Role.team("admin")),
              Permission.delete(Role.user(userId)),
              Permission.update(Role.user(userId)),
            ]      
          );
          await userTimeline.follow("user", programId);
          return res.json(subscription);
        }else{
          log(`subscription already exists for: ${userId} to program: ${programId}, ignoring`);
          // make sure we are following
          await userTimeline.follow("user", programId);
          return res.json(existing);
        }        
      }
      if (req.method === 'DELETE') {
        log(`delete`);
        const {documents} = await db.listDocuments(
          process.env.APPWRITE_DATABASE_ID!,
          "subscription",
          [
            Query.equal("userKey",userId),
            Query.equal("programKey",programId)
          ]
        );
        if(documents.length === 0)throw new Error("delete called for subscription that does not exist");
        const subscription = documents[0];
        const deleted = await db.deleteDocument(
          process.env.APPWRITE_DATABASE_ID!,
          "subscription",
          subscription.$id,
        );
        await userTimeline.unfollow("user", programId);
        log("subscription deleted");
        return res.json(deleted);        
      }
  }catch(e:any) {
    error(e);
    throw e;
  }
};
