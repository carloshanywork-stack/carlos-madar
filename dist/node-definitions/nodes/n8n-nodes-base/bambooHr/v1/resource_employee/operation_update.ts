/**
 * BambooHR Node - Version 1
 * Discriminator: resource=employee, operation=update
 */


interface Credentials {
  bambooHrApi: CredentialReference;
}

/** Update an employee */
export type BambooHrV1EmployeeUpdateParams = {
  resource: 'employee';
  operation: 'update';
/**
 * Employee ID
 */
    employeeId: string | Expression<string>;
/**
 * Whether the employee to create was added to a pay schedule synced with Trax Payroll
 * @default false
 */
    synced?: boolean | Expression<boolean>;
/**
 * Address
 * @displayOptions.show { synced: [true] }
 * @default {}
 */
    addasasress?: {
        /** Address
     */
    value?: {
      /** Line 1
       */
      address1?: string | Expression<string>;
      /** Line 2
       */
      address2?: string | Expression<string>;
      /** City
       */
      city?: string | Expression<string>;
      /** The full name of the state/province
       */
      state?: string | Expression<string>;
      /** The name of the country. Must exist in the BambooHr country list.
       */
      country?: string | Expression<string>;
    };
  };
/**
 * Date of Birth
 * @displayOptions.show { synced: [true] }
 * @required when the displayOptions conditions above match
 */
    dateOfBirth?: string | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getDepartments
 * @displayOptions.show { synced: [true] }
 * @required when the displayOptions conditions above match
 */
    department?: string | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getDivisions
 * @displayOptions.show { synced: [true] }
 * @required when the displayOptions conditions above match
 */
    division?: string | Expression<string>;
/**
 * Employee Number
 * @displayOptions.show { synced: [true] }
 * @required when the displayOptions conditions above match
 */
    employeeNumber?: string | Expression<string>;
/**
 * First Name
 * @displayOptions.show { synced: [true] }
 * @required when the displayOptions conditions above match
 */
    firstName?: string | Expression<string>;
/**
 * Last Name
 * @displayOptions.show { synced: [true] }
 * @required when the displayOptions conditions above match
 */
    lastName?: string | Expression<string>;
/**
 * FLSA Overtime Status
 * @displayOptions.show { synced: [true] }
 * @required when the displayOptions conditions above match
 */
    exempt?: 'exempt' | 'non-exempt' | Expression<string>;
/**
 * Gender
 * @displayOptions.show { synced: [true] }
 * @required when the displayOptions conditions above match
 */
    gender?: 'female' | 'male' | Expression<string>;
/**
 * Hire Date
 * @displayOptions.show { synced: [true] }
 * @required when the displayOptions conditions above match
 */
    hireDate?: string | Expression<string>;
/**
 * Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
 * @loadOptionsMethod getEmployeeLocations
 * @displayOptions.show { synced: [true] }
 * @required when the displayOptions conditions above match
 */
    location?: string | Expression<string>;
/**
 * Marital Status
 * @displayOptions.show { synced: [true] }
 * @required when the displayOptions conditions above match
 */
    maritalStatus?: 'single' | 'married' | 'domesticPartnership' | Expression<string>;
/**
 * Mobile Phone
 * @displayOptions.show { synced: [true] }
 * @required when the displayOptions conditions above match
 */
    mobilePhone?: string | Expression<string>;
/**
 * Pay Per
 * @displayOptions.show { synced: [true] }
 * @required when the displayOptions conditions above match
 */
    paidPer?: 'hour' | 'day' | 'week' | 'month' | 'quater' | 'year' | Expression<string>;
/**
 * Pay Rate
 * @displayOptions.show { synced: [true] }
 * @default {}
 */
    payRate?: {
        /** Pay Rate
     */
    value?: {
      /** Value
       */
      value?: string | Expression<string>;
      /** Currency
       */
      currency?: string | Expression<string>;
    };
  };
/**
 * Pay Type
 * @displayOptions.show { synced: [true] }
 * @required when the displayOptions conditions above match
 */
    payType?: 'commission' | 'contract' | 'daily' | 'exceptionHourly' | 'hourly' | 'monthly' | 'pieceRate' | 'proRata' | 'salary' | 'weekly' | Expression<string>;
/**
 * Preferred Name
 * @displayOptions.show { synced: [true] }
 * @required when the displayOptions conditions above match
 */
    preferredName?: string | Expression<string>;
/**
 * A standard United States Social Security number, with dashes
 * @displayOptions.show { synced: [true] }
 * @required when the displayOptions conditions above match
 */
    ssn?: string | Expression<string>;
/**
 * Update Fields
 * @default {}
 */
    updateFields?: {
    /** Address
     * @displayOptions.show { /synced: [false] }
     * @default {}
     */
    addasasress?: {
        /** Address
     */
    value?: {
      /** Line 1
       */
      address1?: string | Expression<string>;
      /** Line 2
       */
      address2?: string | Expression<string>;
      /** City
       */
      city?: string | Expression<string>;
      /** The full name of the state/province
       */
      state?: string | Expression<string>;
      /** The name of the country. Must exist in the BambooHr country list.
       */
      country?: string | Expression<string>;
    };
  };
    /** Date of Birth
     * @displayOptions.show { /synced: [false] }
     */
    dateOfBirth?: string | Expression<string>;
    /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getDepartments
     * @displayOptions.show { /synced: [false] }
     */
    department?: string | Expression<string>;
    /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getDivisions
     * @displayOptions.show { /synced: [false] }
     */
    division?: string | Expression<string>;
    /** Employee Number
     * @displayOptions.show { /synced: [false] }
     */
    employeeNumber?: string | Expression<string>;
    /** First Name
     * @displayOptions.show { /synced: [false] }
     */
    firstName?: string | Expression<string>;
    /** Last Name
     * @displayOptions.show { /synced: [false] }
     */
    lastName?: string | Expression<string>;
    /** FLSA Overtime Status
     * @displayOptions.show { /synced: [false] }
     */
    exempt?: 'exempt' | 'non-exempt' | Expression<string>;
    /** Gender
     * @displayOptions.show { /synced: [false] }
     */
    gender?: 'female' | 'male' | Expression<string>;
    /** Hire Date
     * @displayOptions.show { /synced: [false] }
     */
    hireDate?: string | Expression<string>;
    /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getEmployeeLocations
     * @displayOptions.show { /synced: [false] }
     */
    location?: string | Expression<string>;
    /** Marital Status
     * @displayOptions.show { /synced: [false] }
     */
    maritalStatus?: 'single' | 'married' | 'domesticPartnership' | Expression<string>;
    /** Mobile Phone
     * @displayOptions.show { /synced: [false] }
     */
    mobilePhone?: string | Expression<string>;
    /** Pay Per
     * @displayOptions.show { /synced: [false] }
     */
    paidPer?: 'hour' | 'day' | 'week' | 'month' | 'quater' | 'year' | Expression<string>;
    /** Pay Rate
     * @displayOptions.show { /synced: [false] }
     * @default {}
     */
    payRate?: {
        /** Pay Rate
     */
    value?: {
      /** Value
       */
      value?: string | Expression<string>;
      /** Currency
       */
      currency?: string | Expression<string>;
    };
  };
    /** Pay Type
     * @displayOptions.show { /synced: [false] }
     */
    payType?: 'commission' | 'contract' | 'daily' | 'exceptionHourly' | 'hourly' | 'monthly' | 'pieceRate' | 'proRata' | 'salary' | 'weekly' | Expression<string>;
    /** Preferred Name
     * @displayOptions.show { /synced: [false] }
     */
    preferredName?: string | Expression<string>;
    /** A standard United States Social Security number, with dashes
     * @displayOptions.show { /synced: [false] }
     */
    ssn?: string | Expression<string>;
    /** Work Email
     */
    workEmail?: string | Expression<string>;
    /** Work Phone
     */
    workPhone?: string | Expression<string>;
  };
};

export type BambooHrV1EmployeeUpdateOutput = {
  success?: boolean;
};

export type BambooHrV1EmployeeUpdateNode = {
  type: 'n8n-nodes-base.bambooHr';
  version: 1;
  config: NodeConfig<BambooHrV1EmployeeUpdateParams> & { credentials?: Credentials };
  output?: Items<BambooHrV1EmployeeUpdateOutput>;
};