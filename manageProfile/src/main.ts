import { Client, Account, Databases, Query, Permission, Role } from 'node-appwrite';
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
      const jwtToken = jsonPayload.jwtToken;      
      if(!jwtToken)throw new Error("No JWT token in request body");          
      
      const userClient = new Client()
        .setEndpoint('https://cloud.appwrite.io/v1')
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
        .setJWT(jwtToken);

      const userAccount = new Account(userClient);

      const userId = (await userAccount.get()).$id;
      if(!userId)throw new Error("No user found from JWT token");
      log(`got userId: ${userId}`);      

      const updates = {
        "name": jsonPayload.name,
        "birthdate": jsonPayload.birthDate,
        "sex": jsonPayload.sex?.toUpperCase(),
        "weight_kg": jsonPayload.weightKg,
        "height_cm": jsonPayload.heightCm,
        "occupation": jsonPayload.occupation,
        "avatar_img_id": jsonPayload.avatarImgId,
        "user_type": ["USER"],
        "user_id": userId,
      }  
      log(`update profile: ${JSON.stringify(updates)}`);

      const client = new Client()
          .setEndpoint('https://cloud.appwrite.io/v1')
          .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
          .setKey(process.env.APPWRITE_API_KEY!);

      const db = new Databases(client);
      const profile = await db.getDocument(process.env.APPWRITE_DATABASE_ID!,
        "profile",
        userId
        ).catch((r) => undefined);
      if(profile?.$id){
        // update the profile
        const doc = await db.updateDocument(process.env.APPWRITE_DATABASE_ID!,
          "profile",
          userId, {
            ...profile,
            ...updates,
          }, 
          [Query.equal("$id",userId)]);        
          return res.send(doc.$id);               
      } else {
        const doc = await db.createDocument(
          process.env.APPWRITE_DATABASE_ID!,
          "profile",
          userId,
          updates,
          [
            Permission.read(Role.users()),        
            Permission.update(Role.team("admin")),
            Permission.delete(Role.team("admin")),
            Permission.update(Role.user(userId)),            
        ]);
        const streamClient = connect(process.env.STREAM_API_KEY!, process.env.STREAM_API_SECRET!, process.env.STREAM_APP_ID!);
        log(`process.env.STREAM_API_KEY: ${process.env.STREAM_API_KEY}`);
        const createResult = await streamClient.user(userId).create(updates);
        log(`createResult id: ${createResult.id}`); 
        //log(`createResult data: ${createResult.data}`);      
        return res.send(doc.$id);
      }
  }catch(e:any) {
    error(e);
    throw e;
  }
};
