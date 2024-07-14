

CREATE DATABASE IF NOT EXISTS petrolpump;


CREATE TABLE `petrolpump`.`m_persons` (
  `Person_id` INT NOT NULL AUTO_INCREMENT,
  `Person_Name` VARCHAR(350) NOT NULL,
  `User_Name` VARCHAR(100) NULL,
  `Password` VARCHAR(100) NULL,
  `Role` VARCHAR(45) NULL,
  `location_code` VARCHAR(45) NULL,
  created_by VARCHAR(45) NULL,
  updated_by VARCHAR(45) NULL,
  creation_date timestamp,
  updation_date timestamp,
  PRIMARY KEY (`Person_id`));
  
  
  
     CREATE TABLE `petrolpump`.`m_location` (
  `location_id` INT NOT NULL AUTO_INCREMENT,
   location_code VARCHAR(50) NOT NULL,
   location_name VARCHAR(300) NOT NULL,   
   address  VARCHAR(1000) NOT NULL,   
   start_date  timestamp NOT NULL,  
   created_by VARCHAR(45) NULL,
   updated_by VARCHAR(45) NULL,
   creation_date timestamp,
   updation_date timestamp,
   PRIMARY KEY (`location_id`));
  

    CREATE TABLE `petrolpump`.`m_product` (
  `product_id` INT NOT NULL AUTO_INCREMENT,
   product_name VARCHAR(350) NOT NULL,  
   location_code VARCHAR(50) NOT NULL,
   qty decimal(10,3) NOT NULL,
   unit  VARCHAR(50) NOT NULL,  
   price decimal(5,3) NOT NULL,
   created_by VARCHAR(45) NULL,
   updated_by VARCHAR(45) NULL,
   creation_date timestamp,
   updation_date timestamp,
   PRIMARY KEY (`product_id`));

  
  
    
   CREATE TABLE `petrolpump`.`m_pump` (
  `pump_id` INT NOT NULL AUTO_INCREMENT,
   pump_code VARCHAR(350) NOT NULL,
   pump_make  VARCHAR(350) NOT NULL,
   product_code  VARCHAR(50) NOT NULL,  
  `opening_reading` decimal(15,3) Not NULL,
   location_code VARCHAR(50) NOT NULL,
   current_stamping_date timestamp not null,
   Stamping_due  timestamp not null,
   created_by VARCHAR(45) NULL,
   updated_by VARCHAR(45) NULL,
   creation_date timestamp,
   updation_date timestamp,
   PRIMARY KEY (`pump_id`));
  
  
  CREATE TABLE `petrolpump`.`m_credit_list` (
  `creditlist_id` INT NOT NULL AUTO_INCREMENT,
   location_code VARCHAR(50) NOT NULL,
  `Company_Name` VARCHAR(350) NOT NULL,
  `Opening_Balance` INT Not NULL,
   created_by VARCHAR(45) NULL,
   updated_by VARCHAR(45) NULL,
   creation_date timestamp,
   updation_date timestamp,
   PRIMARY KEY (`creditlist_id`));
  
  
 
   
  
   CREATE TABLE `petrolpump`.`m_expense` (
  `Expense_id` INT NOT NULL AUTO_INCREMENT,
   Expense_name VARCHAR(350) NOT NULL,  
   location_code VARCHAR(50) NOT NULL,
   Expense_default_amt INT,
   created_by VARCHAR(45) NULL,
   updated_by VARCHAR(45) NULL,
   creation_date timestamp,
   updation_date timestamp,
   PRIMARY KEY (`Expense_id`));
  
  
   CREATE TABLE `petrolpump`.`t_closing` (
  `closing_id` INT NOT NULL AUTO_INCREMENT,
   closer_id int not null,
   cashier_id int NOT NULL,
   location_code VARCHAR(50) NOT NULL,
   closing_date timestamp NOT NULL, 
   cash INT not null,
   created_by VARCHAR(45) NULL,
   updated_by VARCHAR(45) NULL,
   creation_date timestamp,
   updation_date timestamp,
   PRIMARY KEY (`closing_id`));
  
  CREATE TABLE `petrolpump`.`t_reading`(
  `reading_id` INT NOT NULL AUTO_INCREMENT,
  `closing_id` INT NOT NULL,
   opening_reading INT NOT NULL,
   closing_reading INT NOT NULL,
   pump_id INT not null,
   price INT not null,
   created_by VARCHAR(45) NULL,
   updated_by VARCHAR(45) NULL,
   creation_date timestamp,
   updation_date timestamp,
   PRIMARY KEY (`reading_id`));
   
   
   
    CREATE TABLE `petrolpump`.`t_expense`(
   `texpense_id` INT NOT NULL AUTO_INCREMENT,
   `closing_id` INT NOT NULL,
    amount INT NOT NULL,   
    created_by VARCHAR(45) NULL,
    updated_by VARCHAR(45) NULL,
    creation_date timestamp,
    updation_date timestamp,
    PRIMARY KEY (`texpense_id`));


    ALTER TABLE `petrolpump`.`t_expense`
    ADD expense_id INT NOT NULL AFTER closing_id;   
    
   
	
   CREATE TABLE `petrolpump`.`t_denomination`(
   `denom_id` INT NOT NULL AUTO_INCREMENT,
   `denomination` INT NOT NULL,
    denomcount INT NOT NULL,   
   `closing_id` INT NOT NULL,
    created_by VARCHAR(45) NULL,
    updated_by VARCHAR(45) NULL,
    creation_date timestamp,
    updation_date timestamp,
    PRIMARY KEY (`denom_id`)); 

     CREATE TABLE `petrolpump`.`t_credits`(
    `tcredit_id` INT NOT NULL AUTO_INCREMENT,   
    `closing_id` INT NOT NULL,
     bill_no INT NOT NULL,
     creditlist_id INT NOT NULL,
    `product_id` INT NOT NULL,      
     price decimal(5,3) NOT NULL,
     amount INT NOT NULL,
     created_by VARCHAR(45) NULL,
     updated_by VARCHAR(45) NULL,
     creation_date timestamp,
     updation_date timestamp,
     PRIMARY KEY (`tcredit_id`)); 


   CREATE TABLE `petrolpump`.`t_testing`(
   `testing_id` INT NOT NULL AUTO_INCREMENT,   
   `closing_id` INT NOT NULL,
    product_id INT NOT NULL,
    qty INT NOT NULL,
    created_by VARCHAR(45) NULL,
    updated_by VARCHAR(45) NULL,
    creation_date timestamp,
    updation_date timestamp,
    PRIMARY KEY (`testing_id`)); 


    CREATE TABLE `petrolpump`.`t_cashsales`(
   `cashsales_id` INT NOT NULL AUTO_INCREMENT,   
   `Bill_no` INT NOT NULL,
    product_id INT NOT NULL,
    price decimal(5,3) NOT NULL,
    qty INT NOT NULL,
    created_by VARCHAR(45) NULL,
    updated_by VARCHAR(45) NULL,
    creation_date timestamp,
    updation_date timestamp,
    PRIMARY KEY (`cashsales_id`)); 

   -- Data 
	
	INSERT INTO `petrolpump`.`m_persons`
(
`Person_Name`,
`User_Name`,
`Password`,
`Role`,
`Location_code`,
`created_by`,
`updated_by`,
`creation_date`,
`updation_date`)VALUES
    ('Marimuthu','mmuthu','welcome123','Manager','MC2','admin'
     ,'admin',sysdate(),sysdate()
),
    ('Venugopal','vgopal','welcome123','Manager','MC','admin'
     ,'admin',sysdate(),sysdate()
),
   ('admin','admin','welcome123','admin',null,'admin'
     ,'admin',sysdate(),sysdate()
),
   ('venkatachalam','venkatach','welcome123','cashier','MC2','admin'
     ,'admin',sysdate(),sysdate()
),
   ('Indhu','indhu','welcome123','Cashier','MC','admin'
     ,'admin',sysdate(),sysdate()
)

;



INSERT INTO `petrolpump`.`m_location`
(
`location_code`,
`location_name`,
`address`,
`start_date`,
`created_by`,
`updated_by`,
`creation_date`,
`updation_date`)
VALUES ('MC','Muthu Corporation','737 Uthukuli Road Kunnathur 638103',sysdate(),
     'admin','admin',sysdate(),sysdate()
),
('MME','MuthuMani Enterprises','737 Perumanallur Road Kunnathur 638103',sysdate(),
     'admin','admin',sysdate(),sysdate()
),
('MC2','Muthu Corporation Unit2','105 Mill Road Gobi 638103',sysdate(),
     'admin','admin',sysdate(),sysdate()
)
;


INSERT INTO `petrolpump`.`m_product`
(
`product_name`,
`location_code`,
`qty`,
`unit`,
`price`,
`created_by`,
`updated_by`,
`creation_date`,
`updation_date`)
VALUES
('Motor Spirit','MC',10000,'Liters',73.23,
'admin','admin',sysdate(),sysdate()),
('High Speed Diesel','MC',12050,'Liters',70.89,
'admin','admin',sysdate(),sysdate()),
('Xtra Premium Petrol','MC',8300,'Liters',76.23,
'admin','admin',sysdate(),sysdate()),
('Motor Spirit','MME',10000,'Liters',73.23,
'admin','admin',sysdate(),sysdate()),
('High Speed Diesel','MME',12050,'Liters',70.89,
'admin','admin',sysdate(),sysdate()),
('Xtra Premium Petrol','MME',8300,'Liters',76.23,
'admin','admin',sysdate(),sysdate()),
('Motor Spirit','MC2',10000,'Liters',73.56,
'admin','admin',sysdate(),sysdate()),
('High Speed Diesel','MC2',12050,'Liters',70.94,
'admin','admin',sysdate(),sysdate()),
('Xtra Premium Petrol','MC2',8300,'Liters',76.56,
'admin','admin',sysdate(),sysdate())
;




INSERT INTO `petrolpump`.`m_pump`
(
`pump_code`,
`pump_make`,
`product_code`,
`opening_reading`,
`location_code`,
`current_stamping_date`,
`Stamping_due`,
`created_by`,
`updated_by`,
`creation_date`,
`updation_date`)
VALUES
('MS1','Midco','MS',2038610.6,'MC2',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('MS2','Midco','MS',2448610.6,'MC2',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('MS3','Midco','MS',3038610.6,'MC2',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('MS4','Midco','MS',2348610.6,'MC2',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('HSD1','Midco','HSD',2038610.6,'MC2',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('HSD2','Midco','HSD',2038610.6,'MC2',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('HSD3','Midco','HSD',2038610.6,'MC2',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('HSD4','Midco','HSD',2038610.6,'MC2',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('MS1','Midco','MS',2038610.6,'MC',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('MS2','Midco','MS',2448610.6,'MC',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('MS3','Midco','MS',3038610.6,'MC',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('MS4','Midco','MS',2348610.6,'MC',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('HSD1','Midco','HSD',2038610.6,'MC',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('HSD2','Midco','HSD',2038610.6,'MC',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('HSD3','Midco','HSD',2038610.6,'MC',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('HSD4','Midco','HSD',2038610.6,'MC',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('MS1','Midco','MS',2038610.6,'MME',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('MS2','Midco','MS',2448610.6,'MME',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('MS3','Midco','MS',3038610.6,'MME',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('MS4','Midco','MS',2348610.6,'MME',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('HSD1','Midco','HSD',2038610.6,'MME',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('HSD2','Midco','HSD',2038610.6,'MME',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('HSD3','Midco','HSD',2038610.6,'MME',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
),
('HSD4','Midco','HSD',2038610.6,'MME',sysdate(),sysdate(),
'admin','admin',sysdate(),sysdate()
);


INSERT INTO `petrolpump`.`m_credit_list`
(`location_code`,
`Company_Name`,
`Opening_Balance`,
`created_by`,
`updated_by`,
`creation_date`,
`updation_date`)
VALUES
(
'MC2',
'Saratha School',
'140000',
'admin',
'admin',
sysdate(),sysdate()
),
(
'MC',
'SSBS Borewells',
'113000',
'admin',
'admin',
sysdate(),sysdate()
),
(
'MC2',
'Chennai Silks',
'13567.67',
'admin',
'admin',
sysdate(),sysdate()
),
(
'MME',
'Periyasamy Hydraulics',
'23050.90',
'admin',
'admin',
sysdate(),sysdate()
);







  