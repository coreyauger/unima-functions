import { Client, Account, Databases, Permission, ID, Role, Teams } from 'node-appwrite';
import { connect } from 'getstream';
import { Context, throwIfMissing } from './libs/FunctUtils.js';

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
      const update = jsonPayload.organization;             
      
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

      const streamClient = connect(process.env.STREAM_API_KEY!, process.env.STREAM_API_SECRET!, process.env.STREAM_APP_ID!);
      const db = new Databases(client);
      const organization = await db.getDocument(process.env.APPWRITE_DATABASE_ID!,
        "organization",
        update.$id
        ).catch((r) => undefined);
      if(organization?.$id){        
        log("Found organization: " + JSON.stringify(organization));        
        // TODO: check if they are admin
        log("organization updated!");
        await db.updateDocument(process.env.APPWRITE_DATABASE_ID!,
            "profile",
            (organization as any).profile.$id, {
              ...update.profile
            });
        log("organization profile updated!");
        log("update team members");
      
        const teams = new Teams(client);
        // TODO: add admins     
        // await Promise.all(instructorsToAdd.map((pid:string) => 
        //   teams.createMembership(organization.$id, ["member"], `https://cloud.appwrite.io`, undefined, pid)
        // ));
        log("Team members assigned");
        log("Doing update on organization: " + JSON.stringify(update));
        const doc = await db.updateDocument(process.env.APPWRITE_DATABASE_ID!,
          "organization",
          organization?.$id, {
            ...update,
            profile: (organization as any).profile.$id, // Don't allow a profile id change            
          });
        return res.json(doc);               
      } else {        
        log("Create a new organization profile with data: " + JSON.stringify(update.profile));
        const transaction = async () => {
          const profile = await db.createDocument(
            process.env.APPWRITE_DATABASE_ID!,
            "profile",
            ID.unique(),
            update.profile,
            [
              Permission.read(Role.users()),        
              Permission.update(Role.team("admin")),
              Permission.delete(Role.team("admin")),
              Permission.update(Role.user(userId)),            
          ]);
          log(`organization profile: ${JSON.stringify(profile)}`);
          
          try{
            const organization = await db.createDocument(
              process.env.APPWRITE_DATABASE_ID!,
              "organization",
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
            log(`organization: ${JSON.stringify(organization)}`);
            log(`create a team for the organization: ${organization.$id}`);
            try{
              const teams = new Teams(client);
              await teams.create(organization.$id, update.profile.name);
              await Promise.all([userId].map((pid:string) => 
                teams.createMembership(organization.$id, ["admin"], `https://cloud.appwrite.io`, undefined, pid)
              ));
              log("Team members assigned");                
              const user = await streamClient.user(profile.$id).getOrCreate(profile);
              await user.update(profile);
              // we want to follow our own feed in the timeline..
              const timelineFeed = streamClient.feed('timeline', profile.$id);
              timelineFeed.follow("user", profile.$id);
              // we also want the admin to follow the organization feed.
              [userId].map((uid: string) => {
                const instructorTimeline = streamClient.feed('timeline', uid);
                instructorTimeline.follow("user", profile.$id);
              });              
              log("We have a stream result");
              //log(`createResult data: ${createResult.data}`);  
              const doc = await db.getDocument(
                process.env.APPWRITE_DATABASE_ID!,
                "organization",
                organization.$id
              );
              return doc;
            }catch(e: any){
            // rollback
              await db.deleteDocument(process.env.APPWRITE_DATABASE_ID!,"organization",profile.$id);
              throw e;   
            }
           
          }catch(e: any){
            // rollback the profile.
            await db.deleteDocument(process.env.APPWRITE_DATABASE_ID!,"profile",profile.$id);
            throw e;              
          }         
        }
        const organization = await transaction();
        return res.json(organization);     
      }
  }catch(e:any) {
    error(e);
    throw e;
  }
};
