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

      const {documents} = await db.listDocuments(
        process.env.APPWRITE_DATABASE_ID!,
        "subscription",
        [
          Query.equal("userKey",userId)
        ]
      );
      if (req.method === 'POST') {
        if(documents.length){     
          log(`update`);
          const subscription = documents[0];               
          const updatedPrograms = [...(subscription as any).program.map( (p: any) => p.$id ).filter( (s: String) => s !== programId), programId]
          log(`updatedPrograms: ${updatedPrograms}`);
          await db.updateDocument(
            process.env.APPWRITE_DATABASE_ID!,
            "subscription",
            subscription.$id,
            {
              "userKey": userId,
              "program": updatedPrograms
            }        
          );
          await userTimeline.follow("user", programId);
          return res.send(subscription.$id);
        }else{
          log(`create`);
          const subscription = await db.createDocument(
              process.env.APPWRITE_DATABASE_ID!,
              "subscription",
              ID.unique(),
              {
                "userKey": userId,
                "program": [programId]
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
          return res.send(subscription.$id);
        }
      }
      if (req.method === 'DELETE') {
        if(documents.length){
          log(`delete`);
          const subscription = documents[0];               
          const updatedPrograms = (subscription as any).program.map( (p: any) => p.$id ).filter( (s: String) => s !== programId)
          log(`updatedPrograms: ${updatedPrograms}`);
          await db.updateDocument(
            process.env.APPWRITE_DATABASE_ID!,
            "subscription",
            subscription.$id,
            {
              "userKey": userId,
              "program": updatedPrograms
            }        
          );
          await userTimeline.unfollow("user", programId);
          return res.send(subscription.$id);
        }else{
          throw Error("DELETE called on a document that does not exist");
        }
      }     
  }catch(e:any) {
    error(e);
    throw e;
  }
};
