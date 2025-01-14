
import can from "socketcan";
import {EventEmitter} from 'events';
import { Motor } from './motor.js';

// For reading and writing to config
import path from 'path';
import fs from 'fs';

// For debugging
import { Debug } from './debug.js';
const logger = Debug('igus:robot' + '\t');

/**
 * Igus robot controller
 * 
 */
export class Robot extends EventEmitter   {

  /** -----------------------------------------------------------
   * Constructor
   */
  constructor({ id }) {

    logger(`creating robot with id ${id}`);

    // Becasuse we are event emitter
    super();

    // Create channel
    this.channel = can.createRawChannel('can1', true);

    // Define parameters
    this.id = id;
    this.uiFrequency = 1000;          // time in ms to update the ui
    this.cycleTime = 50;              // time in ms to push updates to motors
    this.stopped = false;             // will disable position sends
    this.ready = false;               // if robot is ready
    this.home = false;                // if the robot is currently home
    this.homing = false;              // if the robot is currently homing
    this.moving = false;              // if the robot is moving to a given position ( set angles was called )

    // Setup robot
    this.setup();
  }

  /** ------------------------------
   * setup
   */
  setup() {

    // First read in the config 
    this.readConfig();
    
    // Create motors
    this.motorMap = {};

    // Each motor is tracked by a name 
    this.motorMap.j0 = new Motor({id: 'j0', canId: 0x10, channel: this.channel });

    // Array for iteration
    this.motors = Object.values(this.motorMap);

    // Subscribe to events for all motors
    this.motors.forEach(motor => {
      motor.on('homing', () => this.robotState() );
      motor.on('home', (id) => this.motorHomed(id) );
      motor.on('disabled', () => this.robotState() );
      motor.on('enabled', () => this.robotState() );
      motor.on('reset', () => this.robotState() );
    });

    // Start robot
    this.start();
   }

  /** ---------------------------------
   * Starts up the robot
   */
  start() {

    // Will write every 50ms ( frequency for controller)
    setInterval(() => {
      this.writeJointSetPoints();
    }, this.cycleTime);

    // Will push updates to ui 
    setInterval(() => {
      this.emit('state', this.state);
    }, this.uiFrequency);

    // Report all encoder updates at 100ms interval
    setInterval(()=>{
    	this.emit('encoder');
    }, 100);

    logger(`robot with id ${this.id} is ready`);
    this.ready = true;
    this.emit('ready');
    this.channel.start();
  }

  /** ---------------------------------
   * Will trigger a robot state update 
   */
  robotState(){
    this.emit('state');
  }

  /** ---------------------------------
   * Will evaluate if the whole robot is home 
   */
  motorHomed(id){
    logger(`motor ${id} is homed`);

    // If we are homing robot check to see if we are all done homing
    if(this.homing && this.motors.every( motor => motor.home)){
      logger(`all motors are home!`);
      this.home = true 
      this.homing = false;
    }

    this.emit('meta');
    this.emit('state');
  }

  /** ---------------------------------
   * Will write out the pos values for joint 
   */
  writeJointSetPoints(){

    // If we are are stopped then dont send anything
    if(this.stopped){
      return;
    }

    // Write out set points for all motors
    this.motors.forEach( motor => {
      motor.writeJointSetPoints();
    });
  }

  /* -------------------- Motor Actions -------------------- */

  motorSetPosition(id, position, velocity){
    logger(`set position for motor ${id} velocity ${velocity}`);
    this.motorMap[id].setPosition(position, velocity)
  }

  motorHome(id){
    logger(`homing motor ${id}`);
    this.motorMap[id].goHome()
  }

  motorResetErrors(id){
    logger(`resetErrors for motor ${id}`);
    this.motorMap[id].reset()
  }

  motorEnable(id){
    logger(`enable motor ${id}`);
    this.motorMap[id].enable()
  }

  motorDisable(id){
    logger(`disableMotor ${id}`);
    this.motorMap[id].disable()
  }

  motorZero(id){
    logger(`zero motor ${id}`);
    this.motorMap[id].zero();
  }

  motorCalibrate(id){
    logger(`calibrateMotor ${id}`);
    this.motorMap[id].calibrate()
  }

  queryMotorPosition(id){
    logger(`queryMotorPosition ${id}`);
    this.motorMap[id].queryPosition();
  }

  queryMotorParamter(id, index, subindex){
    logger(`queryMotorParamter ${id} index ${index} subindex ${subindex}`);
    this.motorMap[id].queryParameter(index, subindex);
  }

  /* -------------------- Robot Actions -------------------- */

  robotHome(){
    logger(`home robot`);

    // Update our state
    this.homing = true;

    this.motors.forEach( motor => {
      motor.goHome();
    });
  }

  robotStop(){
    logger(`stop robot`);

    this.stopped = true;

    // Disable all motors
    this.motors.forEach(motor => {
      motor.disable();
    });     

    this.emit("meta");
  }

  robotCenter(){
    logger(`center robot`);

    // We are moving whole robot
    this.moving = true;

    // Centers all motors
    this.motors.forEach(motor => {
      motor.zero();
    });     

    this.emit("meta");
  }

  robotReset(){
    logger(`reset robot`);

    this.stopped = false;

    // Enable all motors
    this.motors.forEach(motor => {
      motor.reset();
    });     

    this.emit("meta");
  }

  robotEnable(){
    logger(`enable robot`);

    this.stopped = false;

    // Enable all motors
    this.motors.forEach(motor => {
      motor.enable();
    });     

    this.emit("meta");
  }

  /** ---------------------------------
   * Will get the current robot state 
   * 
   * use-case for this will be for a UI to poll this periodically and update for user to view
   */
  get state(){
      // Build motors state object
      const motors = {};
      this.motors.forEach( motor => {
        motors[motor.id] = motor.state;
      });
  
      // return state
      return {
        id: this.id,
        motors
      }
  }

  /** ---------------------------------
   * Will get the current robot metadata  
   */
  get meta(){
     // Build motors state object
     const motors = {};
     this.motors.forEach( motor => {
       motors[motor.id] = { id: motor.id };
     });
 
     // return meta
     return {
       stopped: this.stopped, 
       ready: this.ready, 
       home: this.home,
       homing: this.homing,
       moving: this.moving,
       motors
     }
  }

  /** ------------------------------
   * readConfig
   */
  readConfig() {
    // Read in config file ( create if it does not exist yet )
    try {
      // Get filename
      const filename = path.resolve('config.json');

      // Check if it exists and create if it does not
      if (!fs.existsSync(filename)) {
        console.log('Config file does not exist creating');
        fs.writeFileSync(filename, JSON.stringify({}));
      }

      // Read in config file
      const config = JSON.parse(fs.readFileSync(filename, 'utf8'));

      logger('Successfully read in config', config);

      this.config = config;
    } catch (err) {
      console.error(err);
    }
  }
  
  /** ------------------------------
   * writeConfig
   */
  writeConfig() {
    logger('Writing config to file', this.config);
    try {
      // Get filename
      const filename = path.resolve('config.json');
      // Write config
      fs.writeFileSync(filename, JSON.stringify(this.config));
    } catch (err) {
      console.error(err);
    }
  }

  /** ------------------------------
   * updateConfig
   *
   * By default this will NOT save to the file it will only update in memory
   * Note: a call to writeConfig() at any time will save everything that has been updated to the file
   */
  updateConfig(key, value, save = false) {
    logger(`updating config ${key} to ${value}`);

    // Special check ( dont let user set a config param to null !! )
    if (value == null) {
      logger(`Unable to set ${key} to ${value} as its null`);
      return;
    }

    // Example key = "j0.limitAdj"
    if (key.includes('.')) {
      const [joint, param] = key.split('.');

      // Update the config
      this.config[joint][param] = value;

      // Update the motor
      this.motorMap[joint][param] = value;

      // Special case for limitAdj
      if (param === 'limitAdj') {
        logger('Updating limitAdj so we need to also update zero step');
        this.motorMap[joint].updateZeroStep();
      }
    } else {
      this.config[key] = value;
    }

    // Now write the config out
    if (save) this.writeConfig();

    logger(`updated config`, this.config);

    this.emit('meta');
  }

}
