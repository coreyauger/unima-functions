import { Client, Account, Databases, Query, Permission, Role } from 'node-appwrite';

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
      const jwtToken = jsonPayload.jwtToken;      
      if(!jwtToken)throw new Error("No JWT token in request body");

      const updates = {
        "name": jsonPayload.name,
        "birthdate": jsonPayload.birthDate,
        "sex": jsonPayload.sex?.toUpperCase(),
        "weight_kg": jsonPayload.weightKg,
        "height_cm": jsonPayload.heightCm,
        "occupation": jsonPayload.occupation,
        "avatar_img_id": jsonPayload.avatarImgId,
        "user_type": ["USER"]
      }      
      
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
      const profile = await db.getDocument(process.env.APPWRITE_DATABASE_ID!,
        "profile",
        userId
        ).catch((r) => undefined);
      if(profile?.$id){
        // update the profile
        return await db.updateDocument(process.env.APPWRITE_DATABASE_ID!,
          "profile",
          userId, {
            ...profile,
            ...updates,
          }, 
          [Query.equal("$id",userId)]);                   
      } else {
        return await db.createDocument(
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
      }
  }catch(e:any) {
    error(e);
    throw e;
  }
};
