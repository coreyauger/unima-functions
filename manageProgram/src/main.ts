import { Client, Account, Databases, Permission, ID, Role, Teams } from 'node-appwrite';
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
      const update = jsonPayload.program;             
      
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
      const program = await db.getDocument(process.env.APPWRITE_DATABASE_ID!,
        "program",
        update.$id
        ).catch((r) => undefined);
      if(program?.$id){
        log("Found program, doing update: " + JSON.stringify(update));
        // TODO: check if the this is the instructor        
        const doc = await db.updateDocument(process.env.APPWRITE_DATABASE_ID!,
          "program",
          program?.$id, {
            ...update,
            profile: (program as any).profile.$id, // Don't allow a profile id change
          });
        log("program updated!");
        await db.updateDocument(process.env.APPWRITE_DATABASE_ID!,
            "profile",
            (program as any).profile.$id, {
              ...update.profile
            });
        log("program profile updated!");
        log("update team members");
        const teams = new Teams(client);
        await Promise.all((program as any).instructor.profile.map((pid:string) =>
          teams.createMembership((program as any).profile.$id, ["member"], "", undefined, pid)
        ));
        log("Team members assigned");
        return res.json(doc);               
      } else {        
        const profileId = ID.unique();
        log("Create a new program profile with data: " + JSON.stringify(update.profile));
        const profile = await db.createDocument(
          process.env.APPWRITE_DATABASE_ID!,
          "profile",
          profileId,
          update.profile,
          [
            Permission.read(Role.users()),        
            Permission.update(Role.team("admin")),
            Permission.delete(Role.team("admin")),
            Permission.update(Role.user(userId)),            
        ]);
        log(`program profile: ${JSON.stringify(profile)}`);
        const program = await db.createDocument(
          process.env.APPWRITE_DATABASE_ID!,
          "program",
          profile.$id,
          {
            ...update,
            profile: profile.$id,
          },
          [
            Permission.read(Role.users()),        
            Permission.update(Role.team("admin")),
            Permission.delete(Role.team("admin")),
            Permission.update(Role.user(userId)),            
        ]);
        log(`program: ${JSON.stringify(program)}`);
        log(`create a team for the program: ${program.$id}`);
        const teams = new Teams(client);
        await teams.create(program.$id, update.profile.name);
        log(`members: ${update.instructor.profile.join(",")}`)
        await Promise.all(update.instructor.profile.map((pid:string) => 
          teams.createMembership(program.$id, ["member"], `https://cloud.appwrite.io`, undefined, pid)
        ));
        log("Team members assigned");
        const streamClient = connect(process.env.STREAM_API_KEY!, process.env.STREAM_API_SECRET!, process.env.STREAM_APP_ID!);
        const user = await streamClient.user(profile.$id).getOrCreate(profile);
        await user.update(profile);
        // we want to follow our own feed in the timeline..
        const timelineFeed = streamClient.feed('timeline', profile.$id);
        timelineFeed.follow("user", profile.$id);
        log("We have a stream result");
        //log(`createResult data: ${createResult.data}`);  
        const doc = await db.getDocument(
          process.env.APPWRITE_DATABASE_ID!,
          "program",
          program.$id
        );
        return res.json(doc);
      }
  }catch(e:any) {
    error(e);
    throw e;
  }
};
