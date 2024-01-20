import { Client, Account, Databases, Query } from 'node-appwrite';

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

      const {documents} = await db.listDocuments(
        process.env.APPWRITE_DATABASE_ID!,
        "subscription",
        [
          Query.equal("user_key",userId )
        ]
      );
      log(`documents: ${documents}`);
      const program = await db.getDocument(
        process.env.APPWRITE_DATABASE_ID!,
        "program",
        programId
      );
      log(`program: ${program}`)
      if(documents.length){                
        log(`update`);
        /*db.updateDocument(
          process.env.APPWRITE_DATABASE_ID!,
        "subscription",
        {
          ...document.
        }
        [
          Query.equal("user_key",userId )
        ]
        )*/
      }else{
        log(`create`);
      }

     

      // `res.json()` is a handy helper for sending JSON
      return res.json({
        motto: 'Build like a team of hundreds_',
        learn: 'https://appwrite.io/docs',
        connect: 'https://appwrite.io/discord',
        getInspired: 'https://builtwith.appwrite.io',
      });
  }catch(e:any) {
    error(e);
    throw e;
  }
};
