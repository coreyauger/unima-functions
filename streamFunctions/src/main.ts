import { Client, Account, Databases, Query, Permission, Role, Teams, Models } from 'node-appwrite';
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
      log(req.body);
      const jsonPayload = JSON.parse(req.body);
      const jwtToken = jsonPayload.jwtToken;      
      if(!jwtToken)throw new Error("No JWT token in request body");

      const operation = jsonPayload.operation;
      if(!operation)throw new Error("No operation in request body");
             
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

      log(`operation: ${operation}`);
      const streamClient = connect(process.env.STREAM_API_KEY!, process.env.STREAM_API_SECRET!, process.env.STREAM_APP_ID!);
      if(operation === "token"){
        const programId = jsonPayload.programId;
        if(programId){
          const client = new Client()
            .setEndpoint('https://cloud.appwrite.io/v1')
            .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
            .setKey(process.env.APPWRITE_API_KEY!);
          const db = new Databases(client);
          const program = await db.getDocument(process.env.APPWRITE_DATABASE_ID!,
            "program",
            programId);
            log(`Got program: ${JSON.stringify(program)}`);
          const instructor = (program as any).instructor.profile as [];
          if(!instructor.find( (p: any) => p.$id === userId))throw new Error(`User: ${userId} is not an instructor for this program`);
          const programToken = streamClient.createUserToken(programId);
          log("return program token");
          return res.json({
            programToken
          });  
        }
        const organizationId = jsonPayload.organizationId;   
        if(organizationId){
          const client = new Client()
            .setEndpoint('https://cloud.appwrite.io/v1')
            .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
            .setKey(process.env.APPWRITE_API_KEY!);
          const teams = new Teams(client);		 
          log(`looking up org membership: ${organizationId}`) 
          const memberships: Models.MembershipList = await teams.listMemberships(organizationId);    
          log(`Got membership: ${JSON.stringify(memberships)}`);
          if(memberships.memberships.find((m: Models.Membership) => m.userId === userId)){
            const organizationToken = streamClient.createUserToken(organizationId);
            log("return organization token");
            return res.json({
              organizationToken
            });  
          }
        }         
        // return "this" users token      
        const userToken = streamClient.createUserToken(userId);      
        return res.json({
          userToken
        });      
      }else if(operation === "follow"){
        const profileId = jsonPayload.profileId;
        if(!profileId)throw new Error("No profileId in request body")
        const feed = streamClient.feed('timeline', userId);
        const ret = await feed.follow("user", profileId);
        // send a notificaiton
        const notification = streamClient.feed('notification', profileId);
        const db = new Databases(client);
        const userProfile = await db.getDocument(process.env.APPWRITE_DATABASE_ID!, "profile",userId);
        const profile = await db.getDocument(process.env.APPWRITE_DATABASE_ID!, "profile",profileId);
        const activityData = {
          actor: `user:${userId}`, 
          user: {
            data: userProfile,
            id: userId,
          },
          verb: 'follow', 
          object: `user:${profileId}`,
          profile,
          time: new Date().toISOString()
        }; 
        const activityResponse = await notification.addActivity(activityData as any);
        log("notification response: " + JSON.stringify(activityResponse));
        return res.json({
          ret
        });
      }else if(operation === "unfollow"){
        const profileId = jsonPayload.profileId;
        if(!profileId)throw new Error("No profileId in request body")
        const feed = streamClient.feed('timeline', userId);
        const ret = await feed.unfollow("user", profileId);
        return res.json({
          ret
        });
      }else if(operation === "followStats"){
        const profileId = jsonPayload.profileId;
        if(!profileId)throw new Error("No profileId in request body")
        const feed = streamClient.feed('user', profileId);
        const followerStates = await feed.followStats();
		    const timeline = streamClient.feed('timeline', profileId);
        const followingStates = await timeline.followStats();
        console.log('followStats', {followerStates, followingStates});
        return res.json({
          followers: followerStates.results.followers.count,
          following: followingStates.results.following.count,
        });
      }else if(operation === "followers"){        
        const profileId = jsonPayload.profileId;
        if(!profileId)throw new Error("No profileId in request body")
        const offset = jsonPayload.offset ?? 0;
        // List followers
        const followerIds = await streamClient.feed('user', profileId).followers({limit: 25, offset});
        log("followers ids: " + JSON.stringify(followerIds));
        if(followerIds.results.length === 0)return res.json([]);
        const db = new Databases(client);
        // eg: "feed_id": "timeline:65e13533cf1df9fbe976", "target_id": "user:65d47ab043c6a15f5393",
        const userProfiles: Models.DocumentList<Models.Document> = await db.listDocuments(process.env.APPWRITE_DATABASE_ID!, "profile",[Query.equal("$id", followerIds.results.map((x: {
          created_at: string;
          feed_id: string;
          target_id: string;
          updated_at: string;
        }) => x["feed_id"].replace("timeline:", "") ))]);        
        return res.json(userProfiles.documents);
      }else if(operation === "following"){
        const profileId = jsonPayload.profileId;
        if(!profileId)throw new Error("No profileId in request body")
        const offset = jsonPayload.offset ?? 0;
        // List followers
        const followerIds = await streamClient.feed('timeline', profileId).following({limit: 25, offset});
        log("folowing ids: " + JSON.stringify(followerIds));
        if(followerIds.results.length === 0)return res.json([]);
        const db = new Databases(client);
        // eg: "feed_id": "timeline:65e13533cf1df9fbe976", "target_id": "user:65d47ab043c6a15f5393",
        const userProfiles: Models.DocumentList<Models.Document> = await db.listDocuments(process.env.APPWRITE_DATABASE_ID!, "profile",[Query.equal("$id", followerIds.results.map((x: {
          created_at: string;
          feed_id: string;
          target_id: string;
          updated_at: string;
        }) => x["target_id"].replace("user:", "") ))]);
        return res.json(userProfiles.documents);
      }else if(operation === "notification"){
        const profileId = jsonPayload.profileId;
        if(!profileId)throw new Error("No profileId in request body");
        const verb = jsonPayload.verb;
        if(!profileId)throw new Error("No verb in request body");
        const activity = jsonPayload.activity        
        if(!activity)throw new Error("No activity in request body");
        log("create notification for '"+verb+"' attaching activity: " + JSON.stringify(activity) );
        const notificationFeed = streamClient.feed("notification", profileId);
        const db = new Databases(client);
        const userProfile = await db.getDocument(process.env.APPWRITE_DATABASE_ID!, "profile",userId);
        const activityData = {
          actor: `user:${userId}`, 
          verb: verb, 
          object: activity.id,
          user: {
            data: userProfile,
            id: userId,
          },          
          activity,
          time: new Date().toISOString()
        }; 
        const activityResponse = await notificationFeed.addActivity(activityData as any);
        log("notification response: " + JSON.stringify(activityResponse));
        return res.json(activityResponse);
      }else{
        throw new Error(`Unknown operation: ${operation}`)
      }
  }catch(e:any) {
    error(e);
    throw e;
  }
};
