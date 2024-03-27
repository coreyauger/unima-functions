import { Client, Account, Databases, Permission, ID, Role } from 'node-appwrite';
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
      const update = jsonPayload.session;
      log("session payload: " + JSON.stringify(update));        
      
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
      const program = await db.getDocument(process.env.APPWRITE_DATABASE_ID!,
        "program",
        update.programKey
        ).catch((r) => undefined);
      const series = await db.getDocument(process.env.APPWRITE_DATABASE_ID!,
        "program",
        update.seriesKey
        ).catch((r) => undefined);
      if(!program?.$id)throw new Error("Could not find prorgram for session with id: " + update.programKey);
      if(series?.$id){
        const seriesCheck = (program as any).series.find( (s: any) => s.$id === series.$id);
        if(!seriesCheck)throw new Error("Trying to add session to series that is not in the correct program");
      }
      const instructor = (program as any).instructor.profile as [];
      if(!instructor.find( (p: any) => p.$id === userId))throw new Error(`User: ${userId} is not an instructor for this program`);

      const session = await db.getDocument(process.env.APPWRITE_DATABASE_ID!,
        "session",
        update.$id
        ).catch((r) => undefined);

      if(session?.$id){
        if(req.method === "DELETE"){
          log("delete session: " + session?.$id);
          const doc = await db.updateDocument(process.env.APPWRITE_DATABASE_ID!, "session", session?.$id, {
            status: -1  // SET - NOT ACTIVE
          });         
          return res.json(doc);
        }else{
          log("update session: " + session?.$id);
          const doc = await db.updateDocument(process.env.APPWRITE_DATABASE_ID!, "session", session?.$id, update);
          // instructors get notification for comments
          (doc as any).instructors.map(async (id: string) => {
            const userNotification = await streamClient.feed("notification", id);
            await userNotification.follow("comment", session?.$id);
          });
          return res.json(doc);
        }
      } else {        
        const transaction = async () => {         
          log("Create a new session with data: " + JSON.stringify(update));
          const created = await db.createDocument(process.env.APPWRITE_DATABASE_ID!, "session", ID.unique(), update,
            [
              Permission.read(Role.users()),        
              Permission.update(Role.team("admin")),
              Permission.delete(Role.team("admin")),
              Permission.update(Role.user(userId)),            
          ]);
          // update the totoals for the program
          log("update program totoals");
          await db.updateDocument(process.env.APPWRITE_DATABASE_ID!, "program", program.$id,{
              numSessions: (program as any).numSessions + 1,
              totalTimeMs: (program as any).totalTimeMs + (parseInt(update.length) * 60 * 1000),
          });
          if(series?.$id){
            await db.updateDocument(process.env.APPWRITE_DATABASE_ID!, "series", series.$id,
            {
                numSessions: (series as any).numSessions + 1,
            });
          }
          log(`session: ${JSON.stringify(created)}`);

          // NOTE: we create a post for this session creation in the bunnyWebhook when the session has finished encoding          

          // instructors get notification for comments and session results
          (created as any).instructors.map(async (id: string) => {
            const userNotification = await streamClient.feed("notification", id);
            await userNotification.follow("comment", created.$id);
          });

          return created;
        }   
        const created = await transaction();
        return res.json(created);
      }
  }catch(e:any) {
    error(e);
    throw e;
  }
};
