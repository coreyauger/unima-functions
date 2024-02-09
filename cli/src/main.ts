import yargs, {Argv} from "yargs";
import {hideBin} from "yargs/helpers";
import * as sdk from "node-appwrite";
import * as dotenv from "dotenv";
import fs from "node:fs";

dotenv.config();

const client = new sdk.Client();
    client
        .setEndpoint("https://cloud.appwrite.io/v1")
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID ?? "")
        .setKey(process.env.APPWRITE_API_KEY ?? "");

async function listProfiles() {
    const databases = new sdk.Databases(client);
    const profiles = await databases.listDocuments("unima", "profile");
    profiles.documents.forEach( (p: any) => {
        console.log(p);
    });
}



async function main(){
    
    yargs(hideBin(process.argv))
        .command('list [profiles]', 'start the server', (yargs) => {
            return yargs
            .command('profiles','get a list of profiles',  async (argv) => {
                await listProfiles();
            });
        }, async (argv) => {
            if (argv.verbose) console.info(`start server on :${argv.port}`)           
        })
        .command('create [program]', 'create a resource', (yargs) => {
            return yargs
                .command('program', 'get a list of profiles',(argv) => {
                    console.log("create", argv.argv);
                    fs.readFile((argv.argv as any)["json-file"], 'utf8', (err: any, data: any) => {
                        if (err) {
                          console.error(err);
                          return;
                        }
                        console.log(data);
                    });
                }).option('json-file', {
                    alias: 'f',
                    type: 'string',
                    description: 'json file'
                });
        }, async (argv) => {
            if (argv.verbose) console.info(`start server on :${argv.port}`)
            
        })
        .option('verbose', {
            alias: 'v',
            type: 'boolean',
            description: 'Run with verbose logging'
        })
        .parse();

} 

main();

